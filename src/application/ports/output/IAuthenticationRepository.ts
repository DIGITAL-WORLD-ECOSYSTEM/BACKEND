export interface PasswordCredentialRecord {
  authenticatorId: string;
  userId: number;
  passwordHash: string;
}

export interface TotpCredentialRecord {
  authenticatorId: string;
  userId: number;
  encryptedTotpSecret: string;
  verified: boolean;
}

export interface WebAuthnCredentialRecord {
  authenticatorId: string;
  userId: number;
  credentialId: string;
  publicKeyCose: string;
}

export interface IAuthenticationRepository {
  findPasswordCredentialByUserId(userId: number): Promise<PasswordCredentialRecord | null>;
  savePasswordCredential(userId: number, passwordHash: string): Promise<string>;
  findTotpCredentialByUserId(userId: number): Promise<TotpCredentialRecord | null>;
  saveTotpSecret(userId: number, encryptedTotpSecret: string): Promise<string>;
  verifyTotpAuthenticator(authenticatorId: string): Promise<void>;
  findWebAuthnCredentialByUserId(userId: number): Promise<WebAuthnCredentialRecord | null>;
  saveWebAuthnCredential(
    userId: number,
    credentialId: string,
    publicKeyCose: string,
    rpId?: string
  ): Promise<string>;
}
