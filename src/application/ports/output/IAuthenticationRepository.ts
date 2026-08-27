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
  signCount: number;
}

export interface IAuthenticationRepository {
  findPasswordCredentialByUserId(userId: number): Promise<PasswordCredentialRecord | null>;
  savePasswordCredential(userId: number, passwordHash: string): Promise<string>;
  findTotpCredentialByUserId(userId: number): Promise<TotpCredentialRecord | null>;
  saveTotpSecret(userId: number, encryptedTotpSecret: string): Promise<string>;
  verifyTotpAuthenticator(authenticatorId: string): Promise<void>;
  findAllWebAuthnCredentialsByUserId(userId: number): Promise<WebAuthnCredentialRecord[]>;
  findWebAuthnCredentialById(credentialId: string): Promise<WebAuthnCredentialRecord | null>;
  saveWebAuthnCredential(
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
  ): Promise<string>;
  updateWebAuthnSignCount(credentialId: string, newSignCount: number): Promise<void>;
}
