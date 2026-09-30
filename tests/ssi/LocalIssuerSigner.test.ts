import { describe, it, expect } from 'vitest';
import { LocalIssuerSigner, canonicalizeJson } from '@/infrastructure/security/crypto/LocalIssuerSigner';

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
    const actualIssuerDid = await signer.getIssuerDid();
    const document: any = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: 'urn:uuid:550e8400-e29b-41d4-a716-446655440000',
      type: ['VerifiableCredential', 'CivicIdentityCredential'],
      issuer: actualIssuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: 'did:key:holder-123',
        citizenship: 'BR',
      },
    };

    const proof = await signer.signCredential(document, actualIssuerDid);
    document.proof = proof;

    const isValid = await signer.verifyProof(document);
    expect(isValid).toBe(true);
  });

  it('fails verification (returns false) if document claims are tampered with', async () => {
    const signer = new LocalIssuerSigner(seed);
    const actualIssuerDid = await signer.getIssuerDid();
    const document: any = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: 'urn:uuid:550e8400-e29b-41d4-a716-446655440000',
      type: ['VerifiableCredential', 'CivicIdentityCredential'],
      issuer: actualIssuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: 'did:key:holder-123',
        citizenship: 'BR',
      },
    };

    const proof = await signer.signCredential(document, actualIssuerDid);
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

  it('correctly encodes and decodes W3C multicodec multibase did:key (z6Mk...)', () => {
    const rawKey = new Uint8Array(32).fill(7);
    const didKey = LocalIssuerSigner.encodeDidKey(rawKey);

    expect(didKey.startsWith('did:key:z6Mk')).toBe(true);

    const decoded = LocalIssuerSigner.decodeDidKey(didKey);
    expect(decoded).toBeDefined();
    expect(decoded).toEqual(rawKey);
  });

  it('canonicalizeJson recursively sorts keys for deterministic hashing', () => {
    const objA = { z: 1, a: 2, m: { y: 10, b: 20 } };
    const objB = { a: 2, m: { b: 20, y: 10 }, z: 1 };

    const sortedA = canonicalizeJson(objA);
    const sortedB = canonicalizeJson(objB);

    expect(JSON.stringify(sortedA)).toBe(JSON.stringify(sortedB));
    expect(Object.keys(sortedA)).toEqual(['a', 'm', 'z']);
    expect(Object.keys(sortedA.m)).toEqual(['b', 'y']);
  });

  it('universal verification: verifies a VC signed by an external issuer using its did:key verificationMethod', async () => {
    // External Issuer B signs a document with its own key
    const seedB = new Uint8Array(32).fill(99);
    const signerB = new LocalIssuerSigner(seedB);
    const issuerBDid = await signerB.getIssuerDid();

    const externalDoc: any = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: 'urn:uuid:external-123',
      type: ['VerifiableCredential'],
      issuer: issuerBDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: { id: 'did:key:subject-xyz', degree: 'Computer Science' },
    };

    const proofB = await signerB.signCredential(externalDoc, issuerBDid, `${issuerBDid}#key-1`);
    externalDoc.proof = proofB;

    // Verifier A (which has seed A in memory) verifies External Issuer B's credential
    const signerA = new LocalIssuerSigner(seed);
    const isValid = await signerA.verifyProof(externalDoc);

    expect(isValid).toBe(true);
  });
});
