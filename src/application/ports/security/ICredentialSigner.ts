export interface CredentialProof {
  type: string;
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  proofValue: string;
}

export interface ICredentialSigner {
  /**
   * Generates a cryptographic signature (proof) for a Verifiable Credential or Presentation.
   * @param document The canonicalized JSON document to sign
   * @param issuerDid The DID of the issuer signing the document
   * @param keyId The ID of the key to use (optional, depending on KMS)
   * @returns The generated proof object to be attached to the credential
   */
  signCredential(document: any, issuerDid: string, keyId?: string): Promise<CredentialProof>;

  /**
   * Verifies the cryptographic proof of a Verifiable Credential.
   * @param document The credential document including the proof
   * @returns true if the signature is valid, false otherwise
   */
  verifyProof(document: any): Promise<boolean>;
}
