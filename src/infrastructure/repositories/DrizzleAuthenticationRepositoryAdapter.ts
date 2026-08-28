import { eq, and, isNull, sql } from 'drizzle-orm';
import {
  userAuthenticators,
  passwordCredentials,
  totpCredentials,
  webauthnCredentials,
} from '../../db/authentication/tables';
import {
  IAuthenticationRepository,
  PasswordCredentialRecord,
  TotpCredentialRecord,
  WebAuthnCredentialRecord,
} from '../../application/ports/output/IAuthenticationRepository';

export type { PasswordCredentialRecord, TotpCredentialRecord, WebAuthnCredentialRecord };

export class DrizzleAuthenticationRepositoryAdapter implements IAuthenticationRepository {
  constructor(private readonly db: any) {}

  // --------------------------------------------------------------------------
  // PASSWORD CREDENTIALS (Strictly in authentication domain)
  // --------------------------------------------------------------------------
  async findPasswordCredentialByUserId(userId: number): Promise<PasswordCredentialRecord | null> {
    const [row] = await this.db
      .select({
        authenticatorId: passwordCredentials.authenticatorId,
        userId: userAuthenticators.userId,
        passwordHash: passwordCredentials.passwordHash,
      })
      .from(passwordCredentials)
      .innerJoin(userAuthenticators, eq(passwordCredentials.authenticatorId, userAuthenticators.id))
      .where(
        and(
          eq(userAuthenticators.userId, userId),
          eq(userAuthenticators.type, 'password'),
          isNull(userAuthenticators.revokedAt)
        )
      )
      .limit(1);

    if (!row) return null;
    return row;
  }

  async savePasswordCredential(userId: number, passwordHash: string): Promise<string> {
    const existing = await this.findPasswordCredentialByUserId(userId);

    if (existing) {
      await this.db
        .update(passwordCredentials)
        .set({ passwordHash })
        .where(eq(passwordCredentials.authenticatorId, existing.authenticatorId));
      return existing.authenticatorId;
    }

    const authenticatorId = crypto.randomUUID();
    const runTransaction = async (tx: any) => {
      await tx.insert(userAuthenticators).values({
        id: authenticatorId,
        userId,
        type: 'password',
        verifiedAt: new Date(),
      });

      await tx.insert(passwordCredentials).values({
        authenticatorId,
        passwordHash,
      });
    };

    if (typeof this.db.transaction === 'function') {
      await this.db.transaction(runTransaction);
    } else {
      await runTransaction(this.db);
    }

    return authenticatorId;
  }

  // --------------------------------------------------------------------------
  // TOTP CREDENTIALS
  // --------------------------------------------------------------------------
  async findTotpCredentialByUserId(userId: number): Promise<TotpCredentialRecord | null> {
    const [row] = await this.db
      .select({
        authenticatorId: totpCredentials.authenticatorId,
        userId: userAuthenticators.userId,
        encryptedTotpSecret: totpCredentials.encryptedTotpSecret,
        verifiedAt: userAuthenticators.verifiedAt,
      })
      .from(totpCredentials)
      .innerJoin(userAuthenticators, eq(totpCredentials.authenticatorId, userAuthenticators.id))
      .where(
        and(
          eq(userAuthenticators.userId, userId),
          eq(userAuthenticators.type, 'totp'),
          isNull(userAuthenticators.revokedAt)
        )
      )
      .limit(1);

    if (!row) return null;
    return {
      authenticatorId: row.authenticatorId,
      userId: row.userId,
      encryptedTotpSecret: row.encryptedTotpSecret,
      verified: row.verifiedAt !== null,
    };
  }

  async saveTotpSecret(userId: number, encryptedTotpSecret: string): Promise<string> {
    const existing = await this.findTotpCredentialByUserId(userId);
    if (existing) {
      await this.db
        .update(totpCredentials)
        .set({ encryptedTotpSecret })
        .where(eq(totpCredentials.authenticatorId, existing.authenticatorId));
      return existing.authenticatorId;
    }

    const authenticatorId = crypto.randomUUID();
    const runTransaction = async (tx: any) => {
      await tx.insert(userAuthenticators).values({
        id: authenticatorId,
        userId,
        type: 'totp',
      });

      await tx.insert(totpCredentials).values({
        authenticatorId,
        encryptedTotpSecret,
      });
    };

    if (typeof this.db.transaction === 'function') {
      await this.db.transaction(runTransaction);
    } else {
      await runTransaction(this.db);
    }

    return authenticatorId;
  }

  async verifyTotpAuthenticator(authenticatorId: string): Promise<void> {
    const res = await this.db
      .update(userAuthenticators)
      .set({ verifiedAt: new Date() })
      .where(
        and(
          eq(userAuthenticators.id, authenticatorId),
          eq(userAuthenticators.type, 'totp'),
          isNull(userAuthenticators.revokedAt)
        )
      );
    
    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      // Check if already verified or non-existent
      const [existing] = await this.db
        .select()
        .from(userAuthenticators)
        .where(
          and(
            eq(userAuthenticators.id, authenticatorId),
            eq(userAuthenticators.type, 'totp'),
            isNull(userAuthenticators.revokedAt)
          )
        )
        .limit(1);
      if (!existing) {
        throw new Error(`TOTP Authenticator not found or revoked: ${authenticatorId}`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // WEBAUTHN / PASSKEY CREDENTIALS
  // --------------------------------------------------------------------------
  async findAllWebAuthnCredentialsByUserId(userId: number): Promise<WebAuthnCredentialRecord[]> {
    const rows = await this.db
      .select({
        authenticatorId: webauthnCredentials.authenticatorId,
        userId: userAuthenticators.userId,
        credentialId: webauthnCredentials.credentialId,
        publicKeyCose: webauthnCredentials.publicKeyCose,
        signCount: webauthnCredentials.signCount,
      })
      .from(webauthnCredentials)
      .innerJoin(userAuthenticators, eq(webauthnCredentials.authenticatorId, userAuthenticators.id))
      .where(
        and(
          eq(userAuthenticators.userId, userId),
          eq(userAuthenticators.type, 'webauthn'),
          isNull(userAuthenticators.revokedAt)
        )
      );

    return rows;
  }

  async findWebAuthnCredentialById(credentialId: string): Promise<WebAuthnCredentialRecord | null> {
    const [row] = await this.db
      .select({
        authenticatorId: webauthnCredentials.authenticatorId,
        userId: userAuthenticators.userId,
        credentialId: webauthnCredentials.credentialId,
        publicKeyCose: webauthnCredentials.publicKeyCose,
        signCount: webauthnCredentials.signCount,
      })
      .from(webauthnCredentials)
      .innerJoin(userAuthenticators, eq(webauthnCredentials.authenticatorId, userAuthenticators.id))
      .where(
        and(
          eq(webauthnCredentials.credentialId, credentialId),
          eq(userAuthenticators.type, 'webauthn'),
          isNull(userAuthenticators.revokedAt)
        )
      )
      .limit(1);

    if (!row) return null;
    return row;
  }

  async saveWebAuthnCredential(
    userId: number,
    credentialId: string,
    publicKeyCose: string,
    rpId: string,
    backupEligible: boolean,
    backupState: boolean,
    uvInitialized: boolean,
    aaguid?: string,
    attestationFormat?: string,
    attestationObject?: string
  ): Promise<string> {
    const authenticatorId = crypto.randomUUID();
    const runTransaction = async (tx: any) => {
      await tx.insert(userAuthenticators).values({
        id: authenticatorId,
        userId,
        type: 'webauthn',
        verifiedAt: new Date(),
      });

      await tx.insert(webauthnCredentials).values({
        authenticatorId,
        credentialId,
        publicKeyCose,
        rpId,
        backupEligible,
        backupState,
        uvInitialized,
        aaguid,
        attestationFormat,
        attestationObject,
      });
    };

    if (typeof this.db.transaction === 'function') {
      await this.db.transaction(runTransaction);
    } else {
      await runTransaction(this.db);
    }

    return authenticatorId;
  }

  async updateWebAuthnSignCount(credentialId: string, newSignCount: number): Promise<void> {
    const existing = await this.findWebAuthnCredentialById(credentialId);
    if (!existing) {
      throw new Error(`WebAuthn credential not found or revoked: ${credentialId}`);
    }
    if (newSignCount <= existing.signCount) {
      throw new Error(`WebAuthn signCount rollback detected: ${newSignCount} <= ${existing.signCount}`);
    }

    const res = await this.db
      .update(webauthnCredentials)
      .set({ signCount: newSignCount })
      .where(
        and(
          eq(webauthnCredentials.credentialId, credentialId),
          sql`${webauthnCredentials.signCount} < ${newSignCount}`
        )
      );

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      throw new Error(`WebAuthn signCount update failed due to concurrent modification or rollback.`);
    }
  }
}
