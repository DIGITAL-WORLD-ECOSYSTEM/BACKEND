import { describe, it, expect, beforeEach } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { GenerateWeb3ChallengeUseCase } from '../../src/application/use-cases/web3/GenerateWeb3ChallengeUseCase';
import { LinkExternalWalletUseCase } from '../../src/application/use-cases/web3/LinkExternalWalletUseCase';
import { UnlinkExternalWalletUseCase } from '../../src/application/use-cases/web3/UnlinkExternalWalletUseCase';
import { SetPrimaryWalletUseCase } from '../../src/application/use-cases/web3/SetPrimaryWalletUseCase';
import { ViemSiweVerifierAdapter } from '../../src/infrastructure/security/crypto/ViemSiweVerifierAdapter';
import { SiweMessage } from '../../src/domains/web3/value-objects/SiweMessage';
import {
  WalletAlreadyLinkedError,
  ExpiredChallengeError,
  AntiLockoutViolationError,
  WalletNotFoundError,
  WalletOwnershipError,
} from '../../src/domains/web3/errors/Web3Errors';
import {
  IWeb3Repository,
  WalletRecord,
  LinkWalletData,
  CreateInternalWalletWithVaultParams,
} from '../../src/application/ports/output/IWeb3Repository';
import { IAuthTransactionRepository } from '../../src/application/ports/output/IAuthTransactionRepository';
import {
  IAuthenticationRepository,
  PasswordCredentialRecord,
  TotpCredentialRecord,
  WebAuthnCredentialRecord,
} from '../../src/application/ports/output/IAuthenticationRepository';
import { AuthenticationChallenge } from '../../src/domains/identity/entities/AuthenticationChallenge';

class MockWeb3Repository implements IWeb3Repository {
  public wallets: WalletRecord[] = [];
  private nextId = 1;

  async findByAddress(address: string): Promise<WalletRecord | null> {
    const normalized = address.toLowerCase().trim();
    return this.wallets.find((w) => w.addressNormalized === normalized) || null;
  }

  async findByUserId(userId: number): Promise<WalletRecord[]> {
    return this.wallets.filter((w) => w.userId === userId);
  }

  async findActiveByUserId(userId: number): Promise<WalletRecord | null> {
    return this.wallets.find((w) => w.userId === userId && w.status === 'active' && w.isPrimary) || null;
  }

  async linkExternalWallet(data: LinkWalletData): Promise<WalletRecord> {
    const normalized = data.address.toLowerCase().trim();
    const existing = await this.findByAddress(normalized);

    if (existing) {
      if (existing.userId !== data.userId) {
        throw new WalletAlreadyLinkedError(data.address);
      }
      existing.status = 'active';
      existing.verificationStatus = 'verified';
      existing.verificationMethod = data.verificationMethod || 'siwe';
      if (data.isPrimary !== undefined) existing.isPrimary = data.isPrimary;
      return existing;
    }

    const record: WalletRecord = {
      id: this.nextId++,
      userId: data.userId,
      provenance: 'external',
      networkId: data.networkId || 56,
      walletType: 'eoa',
      controlMode: 'external_user',
      address: data.address,
      addressNormalized: normalized,
      label: data.label || 'Web3 Wallet',
      status: 'active',
      verificationStatus: 'verified',
      verificationMethod: data.verificationMethod || 'siwe',
      isPrimary: Boolean(data.isPrimary),
      linkedAt: new Date(),
      version: 1,
    };

    this.wallets.push(record);
    return record;
  }

  async createInternalWallet(wallet: Partial<WalletRecord>): Promise<WalletRecord> {
    const record: WalletRecord = {
      id: this.nextId++,
      userId: wallet.userId!,
      provenance: 'internal',
      networkId: wallet.networkId || 56,
      walletType: 'eoa',
      controlMode: 'platform_key',
      address: wallet.address!,
      addressNormalized: wallet.address!.toLowerCase(),
      label: wallet.label || 'Internal Wallet',
      status: wallet.status || 'active',
      verificationStatus: 'verified',
      isPrimary: Boolean(wallet.isPrimary),
      linkedAt: new Date(),
      version: 1,
    };
    this.wallets.push(record);
    return record;
  }

  async createInternalWalletWithVault(params: CreateInternalWalletWithVaultParams): Promise<{ wallet: WalletRecord; vaultId: number }> {
    const wallet = await this.createInternalWallet(params.wallet);
    return { wallet, vaultId: 999 };
  }

  async updateWallet(wallet: WalletRecord): Promise<WalletRecord> {
    const idx = this.wallets.findIndex((w) => w.id === wallet.id);
    if (idx === -1) throw new Error('Not found');
    this.wallets[idx] = { ...wallet, version: (wallet.version || 1) + 1 };
    return this.wallets[idx];
  }

  async revokeWallet(userId: number, address: string): Promise<boolean> {
    const normalized = address.toLowerCase().trim();
    const w = this.wallets.find((item) => item.userId === userId && item.addressNormalized === normalized);
    if (!w) return false;
    w.status = 'revoked';
    w.isPrimary = false;
    return true;
  }

  async unlinkWallet(userId: number, address: string): Promise<boolean> {
    const normalized = address.toLowerCase().trim();
    const w = this.wallets.find((item) => item.userId === userId && item.addressNormalized === normalized && item.status === 'active');
    if (!w) return false;
    w.status = 'unlinked';
    w.isPrimary = false;
    return true;
  }

  async setPrimaryWallet(userId: number, address: string): Promise<boolean> {
    const normalized = address.toLowerCase().trim();
    const target = this.wallets.find((item) => item.userId === userId && item.addressNormalized === normalized && item.status === 'active');
    if (!target) return false;

    for (const w of this.wallets) {
      if (w.userId === userId) {
        w.isPrimary = w.addressNormalized === normalized;
      }
    }
    return true;
  }
}

class MockAuthTransactionRepository implements IAuthTransactionRepository {
  public challenges = new Map<string, AuthenticationChallenge>();

  async createTransaction(): Promise<void> {}
  async getTransactionById(): Promise<any> { return null; }
  async updateTransaction(): Promise<void> {}

  async createChallenge(challenge: AuthenticationChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async getChallengeById(id: string): Promise<AuthenticationChallenge | null> {
    return this.challenges.get(id) || null;
  }

  async getChallengeByHash(hash: string): Promise<AuthenticationChallenge | null> {
    for (const c of this.challenges.values()) {
      if (c.challengeHash === hash) return c;
    }
    return null;
  }

  async updateChallenge(challenge: AuthenticationChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async completeFactorAtomically(): Promise<boolean> { return true; }
  async recordFailedAttemptAtomically(): Promise<boolean> { return true; }

  async consumeChallengeAtomically(challengeId: string): Promise<boolean> {
    const ch = this.challenges.get(challengeId);
    if (!ch || !ch.isValid()) return false;
    ch.markAsUsed();
    return true;
  }
}

class MockAuthenticationRepository implements IAuthenticationRepository {
  public passwords = new Map<number, string>();
  public webauthn = new Map<number, WebAuthnCredentialRecord[]>();

  async findPasswordCredentialByUserId(userId: number): Promise<PasswordCredentialRecord | null> {
    const hash = this.passwords.get(userId);
    if (!hash) return null;
    return { authenticatorId: 'pwd-1', userId, passwordHash: hash };
  }

  async savePasswordCredential(userId: number, passwordHash: string): Promise<string> {
    this.passwords.set(userId, passwordHash);
    return 'pwd-1';
  }

  async findTotpCredentialByUserId(): Promise<TotpCredentialRecord | null> { return null; }
  async saveTotpSecret(): Promise<string> { return 'totp-1'; }
  async verifyTotpAuthenticator(): Promise<void> {}

  async findAllWebAuthnCredentialsByUserId(userId: number): Promise<WebAuthnCredentialRecord[]> {
    return this.webauthn.get(userId) || [];
  }

  async findWebAuthnCredentialById(): Promise<WebAuthnCredentialRecord | null> { return null; }
  async saveWebAuthnCredential(): Promise<string> { return 'passkey-1'; }
  async updateWebAuthnSignCount(): Promise<void> {}
  async revokeWebAuthnCredential(): Promise<void> {}
}

describe('Web3 Phase 2 Use Cases (SIWE & External Wallets)', () => {
  let web3Repo: MockWeb3Repository;
  let authTxRepo: MockAuthTransactionRepository;
  let authRepo: MockAuthenticationRepository;
  let siweVerifier: ViemSiweVerifierAdapter;

  let generateChallengeUseCase: GenerateWeb3ChallengeUseCase;
  let linkExternalWalletUseCase: LinkExternalWalletUseCase;
  let unlinkExternalWalletUseCase: UnlinkExternalWalletUseCase;
  let setPrimaryWalletUseCase: SetPrimaryWalletUseCase;

  const domain = 'w3.app';

  beforeEach(() => {
    web3Repo = new MockWeb3Repository();
    authTxRepo = new MockAuthTransactionRepository();
    authRepo = new MockAuthenticationRepository();
    siweVerifier = new ViemSiweVerifierAdapter();

    generateChallengeUseCase = new GenerateWeb3ChallengeUseCase(authTxRepo);
    linkExternalWalletUseCase = new LinkExternalWalletUseCase(web3Repo, authTxRepo, siweVerifier);
    unlinkExternalWalletUseCase = new UnlinkExternalWalletUseCase(web3Repo, authRepo);
    setPrimaryWalletUseCase = new SetPrimaryWalletUseCase(web3Repo);
  });

  describe('GenerateWeb3ChallengeUseCase', () => {
    it('generates a valid CSPRNG challenge and stores it in authTxRepo', async () => {
      const result = await generateChallengeUseCase.execute({
        domain,
        address: '0x1111111111111111111111111111111111111111',
      });

      expect(result.challengeId).toBeDefined();
      expect(result.nonce).toHaveLength(32);
      expect(result.domain).toBe(domain);
      expect(result.message).toContain('w3.app wants you to sign in with your Ethereum account:');

      const saved = await authTxRepo.getChallengeById(result.challengeId);
      expect(saved).not.toBeNull();
      expect(saved?.isValid()).toBe(true);
      expect(saved?.challengeHash).toBe(result.nonce);
    });
  });

  describe('LinkExternalWalletUseCase', () => {
    it('successfully links external wallet after valid cryptographic signature', async () => {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      // 1. Gera desafio
      const challenge = await generateChallengeUseCase.execute({ domain, address: account.address });

      // 2. Assina a mensagem canônica com a chave privada
      const signature = await account.signMessage({ message: challenge.message! });

      // 3. Executa vínculo
      const linkResult = await linkExternalWalletUseCase.execute({
        userId: 101,
        challengeId: challenge.challengeId,
        message: challenge.message!,
        signature,
        expectedDomain: domain,
        label: 'MetaMask Pessoal',
        isPrimary: true,
      });

      expect(linkResult.address.toLowerCase()).toBe(account.address.toLowerCase());
      expect(linkResult.wallet.provenance).toBe('external');
      expect(linkResult.wallet.controlMode).toBe('external_user');
      expect(linkResult.wallet.verificationMethod).toBe('siwe');
      expect(linkResult.wallet.isPrimary).toBe(true);
      expect(linkResult.isReactivation).toBe(false);

      // 4. Garante que o desafio foi consumido (anti-replay)
      const consumed = await authTxRepo.getChallengeById(challenge.challengeId);
      expect(consumed?.isUsed()).toBe(true);
    });

    it('rejects replay attack when trying to reuse the same challenge', async () => {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      const challenge = await generateChallengeUseCase.execute({ domain, address: account.address });
      const signature = await account.signMessage({ message: challenge.message! });

      // Primeiro uso com sucesso
      await linkExternalWalletUseCase.execute({
        userId: 101,
        challengeId: challenge.challengeId,
        message: challenge.message!,
        signature,
        expectedDomain: domain,
      });

      // Segundo uso: tentativa de replay attack com mesmo challenge
      await expect(
        linkExternalWalletUseCase.execute({
          userId: 101,
          challengeId: challenge.challengeId,
          message: challenge.message!,
          signature,
          expectedDomain: domain,
        })
      ).rejects.toThrow(ExpiredChallengeError);
    });

    it('rejects linking when address is already linked to another user (anti-collision)', async () => {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      // Usuário 101 vincula a carteira
      const ch1 = await generateChallengeUseCase.execute({ domain, address: account.address });
      const sig1 = await account.signMessage({ message: ch1.message! });
      await linkExternalWalletUseCase.execute({
        userId: 101,
        challengeId: ch1.challengeId,
        message: ch1.message!,
        signature: sig1,
        expectedDomain: domain,
      });

      // Usuário 102 tenta vincular a MESMA carteira
      const ch2 = await generateChallengeUseCase.execute({ domain, address: account.address });
      const sig2 = await account.signMessage({ message: ch2.message! });

      await expect(
        linkExternalWalletUseCase.execute({
          userId: 102,
          challengeId: ch2.challengeId,
          message: ch2.message!,
          signature: sig2,
          expectedDomain: domain,
        })
      ).rejects.toThrow(WalletAlreadyLinkedError);
    });
  });

  describe('UnlinkExternalWalletUseCase', () => {
    it('blocks unlinking if wallet is user ONLY authentication method (Anti-Lockout Protection)', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      await web3Repo.linkExternalWallet({ userId: 101, address });

      // O usuário 101 não tem senha nem passkeys (totalMethods = 1)
      await expect(
        unlinkExternalWalletUseCase.execute({ userId: 101, address })
      ).rejects.toThrow(AntiLockoutViolationError);
    });

    it('allows unlinking when user has a secondary authentication method (password or 2nd wallet)', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';

      await web3Repo.linkExternalWallet({ userId: 101, address: address1 });
      await web3Repo.linkExternalWallet({ userId: 101, address: address2 });

      const result = await unlinkExternalWalletUseCase.execute({ userId: 101, address: address1 });
      expect(result.success).toBe(true);

      const unlinkedWallet = await web3Repo.findByAddress(address1);
      expect(unlinkedWallet?.status).toBe('unlinked');
    });

    it('rejects unlinking a wallet that belongs to another user', async () => {
      const address = '0x1111111111111111111111111111111111111111';
      await web3Repo.linkExternalWallet({ userId: 101, address });
      authRepo.passwords.set(102, 'hash_pwd');

      await expect(
        unlinkExternalWalletUseCase.execute({ userId: 102, address })
      ).rejects.toThrow(WalletOwnershipError);
    });
  });

  describe('SetPrimaryWalletUseCase', () => {
    it('switches primary wallet atomically', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';

      await web3Repo.linkExternalWallet({ userId: 101, address: address1, isPrimary: true });
      await web3Repo.linkExternalWallet({ userId: 101, address: address2, isPrimary: false });

      const res = await setPrimaryWalletUseCase.execute({ userId: 101, address: address2 });
      expect(res.success).toBe(true);
      expect(res.isPrimary).toBe(true);

      const w1 = await web3Repo.findByAddress(address1);
      const w2 = await web3Repo.findByAddress(address2);

      expect(w1?.isPrimary).toBe(false);
      expect(w2?.isPrimary).toBe(true);
    });
  });
});
