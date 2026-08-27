import { eq, and } from 'drizzle-orm';
import { IIdentityResolverPort } from '../../application/ports/output/IIdentityResolverPort';
import { IdentityAssertion } from '../../application/dto/IdentityAssertion';
import { IdentityResolutionResult } from '../../application/dto/IdentityResolutionResult';
import { wallets } from '../../db/web3/tables';
import { webauthnCredentials, oauthIdentities, userAuthenticators } from '../../db/authentication/tables';
import { didIdentities } from '../../db/ssi/tables';

export class DrizzleIdentityResolverAdapter implements IIdentityResolverPort {
  constructor(private readonly db: any) { }

  async resolve(assertion: IdentityAssertion): Promise<IdentityResolutionResult> {
    switch (assertion.type) {
      case 'oauth': {
        const [oauthRecord] = await this.db
          .select({ userId: oauthIdentities.userId })
          .from(oauthIdentities)
          .where(
            and(
              eq(oauthIdentities.provider, assertion.provider),
              eq(oauthIdentities.subjectId, assertion.subjectId),
              eq(oauthIdentities.status, 'active')
            )
          )
          .limit(1);

        if (oauthRecord) {
          return {
            status: 'resolved',
            userId: oauthRecord.userId,
            bindingType: 'oauth',
            provider: assertion.provider,
          };
        }
        break;
      }

      case 'web3_wallet': {
        const normalizedAddress = assertion.subjectId.toLowerCase();

        // Find network by namespace and chainId? Wait, assertion has networkId.
        // If assertion has networkId, we just join web3Networks to enforce the namespace/chainId?
        // Actually, the user's plan mentions namespace + chainId + addressNormalized. 
        // We will assume assertion provides networkId and we just validate it's active.
        const [wallet] = await this.db
          .select({ userId: wallets.userId })
          .from(wallets)
          .where(
            and(
              eq(wallets.addressNormalized, normalizedAddress),
              eq(wallets.networkId, assertion.networkId),
              eq(wallets.status, 'active')
            )
          )
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
          .where(
            and(
              eq(didIdentities.did, assertion.subjectId),
              eq(didIdentities.status, 'active')
            )
          )
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
