import { eq, and } from 'drizzle-orm';
import { IIdentityResolverPort } from '../../application/ports/output/IIdentityResolverPort';
import { IdentityAssertion } from '../../application/dto/IdentityAssertion';
import { IdentityResolutionResult } from '../../application/dto/IdentityResolutionResult';
import { userExternalIdentities } from '../../db/authentication/tables';
import { wallets } from '../../db/web3/tables';
import { webauthnCredentials, userAuthenticators } from '../../db/authentication/tables';
import { didIdentities } from '../../db/ssi/tables';

export class DrizzleIdentityResolverAdapter implements IIdentityResolverPort {
  constructor(private readonly db: any) {}

  async resolve(assertion: IdentityAssertion): Promise<IdentityResolutionResult> {
    switch (assertion.type) {
      case 'oauth': {
        const [identity] = await this.db
          .select({ userId: userExternalIdentities.userId })
          .from(userExternalIdentities)
          .where(
            and(
              eq(userExternalIdentities.provider, assertion.provider),
              eq(userExternalIdentities.providerSubjectId, assertion.subjectId)
            )
          )
          .limit(1);

        if (identity) {
          return {
            status: 'resolved',
            userId: identity.userId,
            bindingType: 'oauth',
            provider: assertion.provider,
          };
        }
        break;
      }

      case 'web3_wallet': {
        const normalizedAddress = assertion.subjectId.toLowerCase();
        const [wallet] = await this.db
          .select({ userId: wallets.userId })
          .from(wallets)
          .where(eq(wallets.addressNormalized, normalizedAddress))
          .limit(1);

        if (wallet && wallet.userId) {
          return {
            status: 'resolved',
            userId: wallet.userId,
            bindingType: 'web3_wallet',
            provider: 'evm',
          };
        }
        break;
      }

      case 'passkey': {
        const [passkey] = await this.db
          .select({ userId: userAuthenticators.userId })
          .from(webauthnCredentials)
          .innerJoin(userAuthenticators, eq(webauthnCredentials.authenticatorId, userAuthenticators.id))
          .where(eq(webauthnCredentials.credentialId, assertion.subjectId))
          .limit(1);

        if (passkey) {
          return {
            status: 'resolved',
            userId: passkey.userId,
            bindingType: 'passkey',
            provider: 'webauthn',
          };
        }
        break;
      }

      case 'ssi_did': {
        const [did] = await this.db
          .select({ userId: didIdentities.userId })
          .from(didIdentities)
          .where(eq(didIdentities.did, assertion.subjectId))
          .limit(1);

        if (did) {
          return {
            status: 'resolved',
            userId: did.userId,
            bindingType: 'ssi_did',
            provider: 'polygonid',
          };
        }
        break;
      }
    }

    return {
      status: 'not_linked',
      code: 'IDENTITY_NOT_LINKED',
      message: 'Identidade não vinculada a nenhuma conta existente.',
    };
  }
}
