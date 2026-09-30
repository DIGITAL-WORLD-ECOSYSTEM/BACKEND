import { describe, it, expect } from 'vitest';
import { LocalIssuerSigner } from '@/infrastructure/security/crypto/LocalIssuerSigner';

describe('LocalIssuerSigner', () => {
  const seed = new Uint8Array(32).fill(42);
  const issuerDid = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';

  it('signs a credential document generating valid Ed25519 proof', async () => {
    const signer = new LocalIssuerSigner(seed);
    const document = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: 'urn:uuid:550e8400-e29b-41d4-a716-446655440000',
      type: ['VerifiableCredential', 'CivicIdentityCredential'],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: 'did:key:holder-123',
        citizenship: 'BR',
      },
    };

    const proof = await signer.signCredential(document, issuerDid);
    expect(proof).toBeDefined();
    expect(proof.type).toBe('Ed25519Signature2020');
    expect(proof.proofPurpose).toBe('assertionMethod');
    expect(proof.proofValue).toBeDefined();
    expect(proof.proofValue.length).toBeGreaterThan(50);
  });

  it('verifies a signed credential document returning true for authentic document', async () => {
    const signer = new LocalIssuerSigner(seed);
    const document: any = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: 'urn:uuid:550e8400-e29b-41d4-a716-446655440000',
      type: ['VerifiableCredential', 'CivicIdentityCredential'],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: 'did:key:holder-123',
        citizenship: 'BR',
      },
    };

    const proof = await signer.signCredential(document, issuerDid);
    document.proof = proof;

    const isValid = await signer.verifyProof(document);
    expect(isValid).toBe(true);
  });

  it('fails verification (returns false) if document claims are tampered with', async () => {
    const signer = new LocalIssuerSigner(seed);
    const document: any = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: 'urn:uuid:550e8400-e29b-41d4-a716-446655440000',
      type: ['VerifiableCredential', 'CivicIdentityCredential'],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: 'did:key:holder-123',
        citizenship: 'BR',
      },
    };

    const proof = await signer.signCredential(document, issuerDid);
    document.proof = proof;

    // Tamper with citizenship
    document.credentialSubject.citizenship = 'US';

    const isValid = await signer.verifyProof(document);
    expect(isValid).toBe(false);
  });

  it('fails verification gracefully (returns false) without throwing when proof is malformed', async () => {
    const signer = new LocalIssuerSigner(seed);
    const document: any = {
      id: 'urn:uuid:123',
      proof: {
        proofValue: 'invalid-base58-signature',
        verificationMethod: 'did:key:123#keys-1',
      },
    };

    const isValid = await signer.verifyProof(document);
    expect(isValid).toBe(false);
  });
});
