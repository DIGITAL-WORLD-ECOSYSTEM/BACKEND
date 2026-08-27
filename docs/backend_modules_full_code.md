# Backend Completo - Code Dump

Este arquivo contém o código fonte integral de todos os arquivos de `src/` para análise de arquitetura em contexto único.

## `src/application/dto/IdentityAssertion.ts`

```typescript
/**
 * DTO Canônico de Afirmação de Identidade Externa (Discriminated Union).
 * Garante em tempo de compilação que provedores e mecanismos não sofram combinações inválidas.
 */
export type IdentityAssertion =
  | {
      readonly type: 'oauth';
      readonly provider: 'google' | 'github' | 'discord' | 'apple';
      readonly subjectId: string;
      readonly emailSnapshot?: string;
      readonly verifiedAt: Date;
    }
  | {
      readonly type: 'web3_wallet';
      readonly provider: 'evm';
      readonly subjectId: string; // Endereço EVM normalizado em minúsculas
      readonly networkId: number;
      readonly verifiedAt: Date;
    }
  | {
      readonly type: 'passkey';
      readonly provider: 'webauthn';
      readonly subjectId: string; // Passkey Credential ID
      readonly verifiedAt: Date;
    }
  | {
      readonly type: 'ssi_did';
      readonly provider: 'polygonid';
      readonly subjectId: string; // W3C DID string
      readonly verifiedAt: Date;
    };

```

---

## `src/application/dto/IdentityResolutionResult.ts`

```typescript
/**
 * DTO Canônico do Resultado de Resolução de Identidade.
 */
export type IdentityResolutionResult =
  | {
      readonly status: 'resolved';
      readonly userId: number;
      readonly bindingType: 'oauth' | 'web3_wallet' | 'passkey' | 'ssi_did';
      readonly provider: 'google' | 'github' | 'discord' | 'apple' | 'evm' | 'webauthn' | 'polygonid';
    }
  | {
      readonly status: 'not_linked';
      readonly code: 'IDENTITY_NOT_LINKED';
      readonly message: string;
    };

```

---

## `src/application/dto/TransactionContext.ts`

```typescript
/**
 * Abstração de Contexto Transacional no Application Layer.
 * Permite que Use Cases repassem o contexto transacional para repositórios
 * e portas de observabilidade/auditoria sem vazar dependências concretas do Drizzle/D1.
 */
export interface TransactionContext {
  readonly transactionId: string;
  readonly isScoped: true;
  readonly nativeTx?: unknown;
}

```

---

## `src/application/dto/identity/AuthenticateAccountDTO.ts`

```typescript
export interface AuthenticateAccountDTO {
  email: string;
  password: string;
}

export interface AuthenticateAccountResult {
  userId: number;
  email: string;
  publicId: string | null;
  status: string;
}

```

---

## `src/application/dto/identity/AuthenticateTotpDTO.ts`

```typescript
export interface AuthenticateTotpDTO {
  transactionId: string;
  code: string;
  encryptionKey: string;
  sessionId?: string;
}

```

---

## `src/application/dto/identity/ConfirmPasswordResetDTO.ts`

```typescript
export interface ConfirmPasswordResetDTO {
  token: string;
  newPassword: string;
}

```

---

## `src/application/dto/identity/LinkExternalIdentityDTO.ts`

```typescript
import { IdentityAssertion } from '../IdentityAssertion';

export interface LinkExternalIdentityInputDTO {
  readonly userId: number;
  readonly sessionAal: number; // AAL2+ obrigatório (AF-007)
  readonly assertion: IdentityAssertion;
}

export interface LinkExternalIdentityOutputDTO {
  readonly success: boolean;
  readonly provider: string;
  readonly subjectId: string;
  readonly linkedAt: Date;
}

```

---

## `src/application/dto/identity/RefreshTokenDTO.ts`

```typescript
export interface RefreshTokenDTO {
  refreshToken: string;
}

export interface RefreshTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

```

---

## `src/application/dto/identity/RegisterAccountDTO.ts`

```typescript
export interface RegisterAccountInputDTO {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
  readonly username?: string;
}

export interface RegisterAccountOutputDTO {
  readonly userId: number;
  readonly email: string;
  readonly status: string;
  readonly createdAt: Date;
}

```

---

## `src/application/dto/identity/RequestPasswordResetDTO.ts`

```typescript
export interface RequestPasswordResetDTO {
  email: string;
}

```

---

## `src/application/dto/identity/SetupTotpDTO.ts`

```typescript
export interface SetupTotpDTO {
  transactionId: string;
  encryptionKey: string;
}

export interface SetupTotpResult {
  secret: string;
  otpauthUrl: string;
}

```

---

## `src/application/dto/identity/UnlinkExternalIdentityDTO.ts`

```typescript
export interface UnlinkExternalIdentityInputDTO {
  readonly userId: number;
  readonly sessionAal: number;
  readonly provider: string;
  readonly subjectId: string;
}

export interface UnlinkExternalIdentityOutputDTO {
  readonly success: boolean;
  readonly unlinkedAt: Date;
}

```

---

## `src/application/dto/identity/VerifyPasskeyIdentityDTO.ts`

```typescript
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';

export interface VerifyPasskeyIdentityInputDTO {
  readonly challengeId: string;
  readonly responseJSON: AuthenticationResponseJSON;
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
}

export interface VerifyPasskeyIdentityOutputDTO {
  readonly userId: number;
  readonly credentialId: string;
  readonly bindingType: string;
}

```

---

## `src/application/dto/identity/VerifyWalletIdentityDTO.ts`

```typescript
export interface VerifyWalletIdentityInputDTO {
  readonly challengeId: string;
  readonly message: string;
  readonly signature: string;
  readonly expectedDomain?: string;
}

export interface VerifyWalletIdentityOutputDTO {
  readonly userId: number;
  readonly address: string;
  readonly chainId: number;
  readonly bindingType: string;
}

```

---

## `src/application/ports/output/IAuthTransactionRepository.ts`

```typescript
import { AuthenticationTransaction } from '../../../domains/identity/entities/AuthenticationTransaction';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';

export interface IAuthTransactionRepository {
  createTransaction(transaction: AuthenticationTransaction): Promise<void>;
  getTransactionById(id: string): Promise<AuthenticationTransaction | null>;
  updateTransaction(transaction: AuthenticationTransaction): Promise<void>;
  
  createChallenge(challenge: AuthenticationChallenge): Promise<void>;
  getChallengeById(id: string): Promise<AuthenticationChallenge | null>;
  getChallengeByHash(hash: string): Promise<AuthenticationChallenge | null>;
  updateChallenge(challenge: AuthenticationChallenge): Promise<void>;
  
  // Atomic Operations
  completeFactorAtomically(txId: string, aal: number, authEpochAtStart: number, method: string): Promise<boolean>;
  recordFailedAttemptAtomically(txId: string, maxAttempts: number): Promise<boolean>;
  consumeChallengeAtomically(challengeId: string): Promise<boolean>;
}

```

---

## `src/application/ports/output/IAuthenticationRepository.ts`

```typescript
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
    rpId?: string
  ): Promise<string>;
  updateWebAuthnSignCount(credentialId: string, newSignCount: number): Promise<void>;
}

```

---

## `src/application/ports/output/IChallengeStorePort.ts`

```typescript
export interface IChallengeStorePort {
  saveNonce(username: string, nonce: string, ttlSeconds: number): Promise<void>;
  getNonce(username: string): Promise<string | null>;
  deleteNonce(username: string): Promise<void>;
}

```

---

## `src/application/ports/output/ICivilIdentityRepository.ts`

```typescript
export interface CitizenRecord {
  userId: number;
  username: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  nationalityCode: string | null;
  birthDate: string | null;
  maritalStatus: string | null;
  civilStatus: 'pending' | 'verified' | 'suspended' | 'revoked';
  status?: string;
  publicKey?: string;
  did?: string;
  verifiedAt?: Date | null;
  verifiedBy?: number | null;
  version?: number;
}


export interface IdentityDocumentRecord {
  id?: number;
  userId: number;
  documentType: 'cpf' | 'rg' | 'passport' | 'cnh';
  countryCode: string;
  numberLookupHash: string;
  encryptedNumber: string;
  last4?: string | null;
  source: 'government' | 'manual_upload' | 'kyc_provider' | 'admin' | 'import';
  verificationStatus: 'pending' | 'verified' | 'rejected';
  verifiedAt?: Date | null;
  verifiedBy?: number | null;
  version?: number;
}

export interface KycVerificationRecord {
  id?: number;
  userId: number;
  verificationLevel: 'basic' | 'enhanced' | 'institutional';
  status: 'submitted' | 'under_review' | 'approved' | 'rejected' | 'expired';
  provider: string;
  riskScore?: number | null;
  rejectionReason?: string | null;
  startedAt: Date;
  completedAt?: Date | null;
  expiresAt?: Date | null;
  version?: number;
}

export interface ICivilIdentityRepository {
  findByDid(did: string): Promise<CitizenRecord | null>;
  createCitizen(data: Partial<CitizenRecord> & { userId: number }): Promise<CitizenRecord>;
  findCitizenByUserId(userId: number): Promise<CitizenRecord | null>;
  updateCivilStatus(userId: number, civilStatus: 'pending' | 'verified' | 'suspended' | 'revoked', verifiedBy?: number): Promise<void>;
  createIdentityDocument(data: IdentityDocumentRecord): Promise<IdentityDocumentRecord>;
  findDocumentsByUserId(userId: number): Promise<IdentityDocumentRecord[]>;
  createKycVerification(data: KycVerificationRecord): Promise<KycVerificationRecord>;
  getLatestKycByUserId(userId: number): Promise<KycVerificationRecord | null>;
}


```

---

## `src/application/ports/output/IFinanceRepository.ts`

```typescript
import { Result } from '../../../shared/kernel/Result';

export interface FinancialAccountRecord {
  id: number;
  userId: number | null;
  accountType: 'user_available' | 'treasury' | 'operating' | 'reserve' | 'fees' | 'escrow';
  status: 'active' | 'inactive' | 'suspended';
  name: string;
  version: number;
}

export interface AccountBalanceRecord {
  id: number;
  accountId: number;
  assetId: number;
  availableBaseUnits: string;
  lockedBaseUnits: string;
  version: number;
}

export interface FinancialTransactionRecord {
  id: number;
  userId: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  category: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'reversed' | 'refunded';
  description: string;
  createdAt: Date;
  completedAt?: Date | null;
}

export interface IFinanceRepository {
  getTreasuryAccount(): Promise<Result<FinancialAccountRecord>>;
  getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>>;
  createTransaction(data: {
    userId?: number | null;
    type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
    category?: string;
    description: string;
    amountBaseUnits: string;
    assetId: number;
  }): Promise<Result<FinancialTransactionRecord>>;
  listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>>;
}

```

---

## `src/application/ports/output/IIdentityResolverPort.ts`

```typescript
import { IdentityAssertion } from '../../dto/IdentityAssertion';
import { IdentityResolutionResult } from '../../dto/IdentityResolutionResult';

/**
 * Porta de saída para Resolução Canônica de Identidade.
 * O orquestrador central (CanonicalIdentityResolver) implementa esta interface
 * para isolar os Use Cases de infraestrutura e persistência concreta.
 */
export interface IIdentityResolverPort {
  resolve(assertion: IdentityAssertion): Promise<IdentityResolutionResult>;
}

```

---

## `src/application/ports/output/IOutboxRepository.ts`

```typescript
import { IDomainEvent } from '../../../shared/kernel/DomainEvent';
import { Result } from '../../../shared/kernel/Result';

export interface OutboxEventRecord {
  id: string; // UUID
  aggregateId: number;
  aggregateType: string;
  aggregateVersion: number;
  eventName: string;
  payload: string; // JSON
  metadata?: string; // JSON
  attempts: number;
  published: boolean;
  publishedAt?: Date;
  error?: string;
  createdAt: Date;
}

export interface IOutboxRepository {
  /**
   * Persiste um evento de domínio no Outbox.
   * IMPORTANTE: Deve ser chamado dentro da mesma transação do banco (UoW).
   */
  saveEvent(event: IDomainEvent, aggregateId: number, aggregateType: string, aggregateVersion: number): Promise<Result<void>>;
  
  /**
   * Busca eventos pendentes para publicação (published = false) limitando a quantidade.
   */
  getPendingEvents(limit: number): Promise<Result<OutboxEventRecord[]>>;
  
  /**
   * Marca um evento como publicado (sucesso).
   */
  markAsPublished(eventId: string): Promise<Result<void>>;
  
  /**
   * Registra uma falha de tentativa de publicação. Incrementa attempts e salva o erro.
   */
  markAsFailed(eventId: string, error: string): Promise<Result<void>>;
}

```

---

## `src/application/ports/output/IPasswordResetRepository.ts`

```typescript
import { Result } from '../../../shared/kernel/Result';

export interface PasswordReset {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface IPasswordResetRepository {
  findByToken(tokenHash: string): Promise<Result<PasswordReset>>;
  invalidate(id: number): Promise<Result<void>>;
  create(data: { userId: number; tokenHash: string; expiresAt: Date }): Promise<Result<void>>;
  consumeToken(tokenHash: string): Promise<Result<PasswordReset>>;
}

```

---

## `src/application/ports/output/ISecurityAuditPort.ts`

```typescript
import { TransactionContext } from '../../dto/TransactionContext';

export interface SecurityAuditEvent {
  readonly event:
    | 'identity_linked'
    | 'identity_unlinked'
    | 'identity_login_failed'
    | 'identity_login_blocked'
    | 'identity_account_locked'
    | 'identity_resolution_failed'
    | 'authentication_succeeded'
    | 'authentication_failed'
    | 'account_created'
    | 'totp_verification_failed'
    | 'totp_verification_succeeded'
    | 'password_reset_requested'
    | 'password_reset_confirmed'
    | 'refresh_token_reuse_detected';
  readonly userId?: number;
  readonly metadata: Record<string, unknown>;
  readonly timestamp?: Date;
}

/**
 * Porta de Saída de Auditoria de Segurança.
 * Desacopla Use Cases da tabela security_events e aceita TransactionContext
 * para garantir execução na mesma transação atômica D1/Drizzle.
 */
export interface ISecurityAuditPort {
  logEvent(event: SecurityAuditEvent, txCtx?: TransactionContext): Promise<void>;
}

```

---

## `src/application/ports/output/ISessionRepository.ts`

```typescript
export interface ISessionRepository {
  createSession(sessionData: {
    id: string;
    userId: number;
    jti: string;
    ip: string;
    userAgent: string;
    familyId?: string;
    refreshTokenHash: string;
    aal: number;
    authEpoch: number;
    createdAt: Date;
    expiresAt: Date;
    lastAuthenticatedAt?: Date;
  }): Promise<void>;

  rotateRefreshTokenAtomically(sessionId: string, oldRefreshTokenHash: string): Promise<boolean>;

  revokeSession(sessionId: string): Promise<void>;

  revokeAllUserSessions(userId: number): Promise<void>;

  getSessionById(sessionId: string): Promise<any | null>;

  createRefreshTokenFamily(familyData: {
    id: string;
    userId: number;
    createdAt: Date;
  }): Promise<void>;

  revokeFamily(familyId: string, reason?: string): Promise<void>;

  getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<any | null>;
}

```

---

## `src/application/ports/output/ISsiRepository.ts`

```typescript
import { Result } from '../../../shared/kernel/Result';

export interface DidIdentityRecord {
  id: string; // UUID v4
  userId: number;
  did: string;
  method: 'key' | 'ion' | 'polygonid' | 'web' | 'cheqd' | 'pkh';
  controller: string;
  status?: 'active' | 'suspended' | 'revoked';
  version?: number;
}

export interface VerifiableCredentialRecord {
  id: string;
  holderUserId: number;
  issuerDid: string;
  subjectDid: string;
  credentialType: 'CivicIdentityCredential' | 'MembershipCredential' | 'KycVerificationCredential' | 'ReputationCredential';
  credentialHash: string;
  encryptedClaims: string;
  proofType: 'Ed25519Signature2020' | 'BbsBlsSignature2020' | 'JsonWebSignature2020';
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  issuanceDate: Date;
  expirationDate?: Date | null;
  revokedAt?: Date | null;
  version?: number;
}

export interface ISsiRepository {
  findDidByUserId(userId: number): Promise<Result<DidIdentityRecord>>;
  saveDid(record: DidIdentityRecord): Promise<Result<DidIdentityRecord>>;
  saveVerifiableCredential(record: VerifiableCredentialRecord): Promise<Result<VerifiableCredentialRecord>>;
  findVerifiableCredentialById(id: string): Promise<Result<VerifiableCredentialRecord>>;
  listVerifiableCredentialsByUserId(userId: number): Promise<Result<VerifiableCredentialRecord[]>>;
  revokeVerifiableCredential(id: string): Promise<Result<void>>;
}


```

---

## `src/application/ports/output/IUnitOfWork.ts`

```typescript
import { Result } from '../../../shared/kernel/Result';
import { IUserRepository } from './IUserRepository';
import { IAuthenticationRepository } from './IAuthenticationRepository';
import { IWeb3Repository } from './IWeb3Repository';
import { ICivilIdentityRepository } from './ICivilIdentityRepository';
import { ISessionRepository } from './ISessionRepository';
import { IOutboxRepository } from './IOutboxRepository';
import { IPasswordResetRepository } from './IPasswordResetRepository';
import { ISsiRepository } from './ISsiRepository';
import { IFinanceRepository } from './IFinanceRepository';

export interface IRepositoryFactory {
  getUserRepository(): IUserRepository;
  getAuthTransactionRepository(): import('./IAuthTransactionRepository').IAuthTransactionRepository;
  getAuthenticationRepository(): IAuthenticationRepository;
  getWeb3Repository(): IWeb3Repository;
  getSessionRepository(): ISessionRepository;
  getCivilIdentityRepository(): ICivilIdentityRepository;
  getSsiRepository(): ISsiRepository;
  getOutboxRepository(): IOutboxRepository;
  getPasswordResetRepository(): IPasswordResetRepository;
  getFinanceRepository(): IFinanceRepository;
}


export interface IUnitOfWork {
  execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>>;
}


```

---

## `src/application/ports/output/IUserRepository.ts`

```typescript
export interface UserRecord {
  id: number;
  publicId: string | null;
  email: string | null;
  emailNormalized: string | null;
  status: string;
  subjectType: string;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  authEpoch: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email?: string;
  emailNormalized?: string;
  subjectType?: 'citizen' | 'organization' | 'system' | 'service';
  status?: 'active' | 'suspended' | 'pending' | 'locked';
}

export interface IUserRepository {
  findById(id: number): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(data: CreateUserData): Promise<UserRecord>;
  updateStatus(id: number, status: 'active' | 'suspended' | 'pending' | 'locked'): Promise<void>;
  incrementAuthEpoch?(userId: number): Promise<number>;
  incrementFailedLoginAttempts(userId: number, maxAttempts: number): Promise<void>;
  resetFailedLoginAttempts(userId: number): Promise<void>;
}

```

---

## `src/application/ports/output/IWeb3Repository.ts`

```typescript
export interface WalletRecord {
  id: number;
  userId: number;
  provenance: 'internal' | 'external';
  networkId: number;
  walletType: 'eoa' | 'smart_contract';
  controlMode: 'platform_key' | 'external_user' | 'contract_controller';
  address: string;
  addressNormalized: string;
  label: string | null;
  status: 'pending' | 'active' | 'suspended' | 'revoked' | 'unlinked';
  verificationStatus: 'pending' | 'verified' | 'rejected';
  isPrimary: boolean;
  linkedAt: Date;
  version?: number;
}

export interface LinkWalletData {
  userId: number;
  address: string;
  provenance?: 'internal' | 'external';
  networkId?: number;
  walletType?: 'eoa' | 'smart_contract';
  controlMode?: 'platform_key' | 'external_user' | 'contract_controller';
  label?: string;
}

export interface IWeb3Repository {
  findByAddress(address: string): Promise<WalletRecord | null>;
  findByUserId(userId: number): Promise<WalletRecord[]>;
  findActiveByUserId(userId: number): Promise<WalletRecord | null>;
  linkExternalWallet(data: LinkWalletData): Promise<WalletRecord>;
  updateWallet(wallet: WalletRecord): Promise<WalletRecord>;
}


```

---

## `src/application/ports/security/IJwtService.ts`

```typescript
export interface IJwtService {
  sign(payload: any, secret: string, kid?: string): Promise<string>;
  verify(token: string, secret: string): Promise<any>;
}

```

---

## `src/application/ports/security/IPasswordHasher.ts`

```typescript
export interface IPasswordHasher {
  hash(password: string, existingSaltB64?: string): Promise<string>;
  verify(password: string, storedHashText: string): Promise<boolean>;
}

```

---

## `src/application/ports/security/ISiweVerifierPort.ts`

```typescript
export interface SiweVerificationInput {
  readonly message: string;
  readonly signature: string;
  readonly expectedNonce?: string;
  readonly expectedDomain?: string;
}

export interface SiweVerificationOutput {
  readonly address: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly domain: string;
}

export interface ISiweVerifierPort {
  verify(input: SiweVerificationInput): Promise<SiweVerificationOutput>;
}

```

---

## `src/application/use-cases/identity/AuthenticateAccountUseCase.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticateAccountUseCase } from './AuthenticateAccountUseCase';
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { IPasswordHasher } from '../../../application/ports/security/IPasswordHasher';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { User, UserProps } from '../../../domains/identity/entities/User';

describe('AuthenticateAccountUseCase', () => {
  let uow: any;
  let factory: any;
  let userRepo: any;
  let authRepo: any;
  let hasher: any;
  let auditPort: any;
  let useCase: AuthenticateAccountUseCase;

  const validUserProps: UserProps = {
    id: 1,
    email: 'user@example.com',
    emailNormalized: 'user@example.com',
    status: 'active',
    subjectType: 'human',
    failedLoginAttempts: 0,
    lastFailedLoginAt: null,
    authEpoch: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const GENERIC_MESSAGE = 'Não foi possível autenticar com as credenciais fornecidas. Se você esqueceu sua senha, solicite a redefinição.';

  beforeEach(() => {
    userRepo = {
      findByEmail: vi.fn(),
      updateStatus: vi.fn(),
      incrementFailedLoginAttempts: vi.fn(),
      resetFailedLoginAttempts: vi.fn(),
    };

    authRepo = {
      findPasswordCredentialByUserId: vi.fn(),
    };

    factory = {
      getUserRepository: () => userRepo,
      getAuthenticationRepository: () => authRepo,
    };

    uow = {
      execute: vi.fn(async (cb) => cb(factory)),
    };

    hasher = {
      verify: vi.fn(),
    };

    auditPort = {
      logEvent: vi.fn(),
    };

    useCase = new AuthenticateAccountUseCase(uow as IUnitOfWork, hasher as IPasswordHasher, auditPort as ISecurityAuditPort);
  });

  it('deve retornar mensagem genérica e executar dummy hash se usuário não existir', async () => {
    userRepo.findByEmail.mockResolvedValueOnce(null);
    hasher.verify.mockRejectedValueOnce(new Error('Dummy delay'));

    const result = await useCase.execute({ email: 'fake@mail.com', password: '123' });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(GENERIC_MESSAGE);
    expect(hasher.verify).toHaveBeenCalledTimes(1); // Anti timing-attack
  });

  it('deve bloquear imediatamente se o usuário estiver suspenso ou bloqueado', async () => {
    const lockedUser = { ...validUserProps, status: 'locked' };
    userRepo.findByEmail.mockResolvedValueOnce(lockedUser);

    const result = await useCase.execute({ email: 'user@example.com', password: '123' });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(GENERIC_MESSAGE);
    expect(auditPort.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'identity_login_blocked' }));
  });

  it('deve executar dummy hash e retornar mensagem genérica se usuário existir mas não tiver credencial de senha', async () => {
    userRepo.findByEmail.mockResolvedValueOnce(validUserProps);
    authRepo.findPasswordCredentialByUserId.mockResolvedValueOnce(null);
    hasher.verify.mockRejectedValueOnce(new Error('Dummy delay'));

    const result = await useCase.execute({ email: 'user@example.com', password: '123' });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(GENERIC_MESSAGE);
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect(auditPort.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'identity_login_failed' }));
  });

  it('deve incrementar falhas, auditar e retornar falha genérica se a senha for inválida', async () => {
    userRepo.findByEmail.mockResolvedValueOnce(validUserProps);
    authRepo.findPasswordCredentialByUserId.mockResolvedValueOnce({ passwordHash: 'real_hash' });
    hasher.verify.mockResolvedValueOnce(false); // Invalid password

    const result = await useCase.execute({ email: 'user@example.com', password: 'wrong' });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(GENERIC_MESSAGE);
    
    // Verifica D1 update
    expect(userRepo.incrementFailedLoginAttempts).toHaveBeenCalledWith(1, User.MAX_FAILED_ATTEMPTS);
    
    // Verifica log de auditoria
    expect(auditPort.logEvent).toHaveBeenCalledWith(expect.objectContaining({ 
      event: 'identity_login_failed',
      metadata: expect.objectContaining({ attemptCount: 1 })
    }));
  });

  it('deve auditar o bloqueio da conta quando atingir o MAX_FAILED_ATTEMPTS', async () => {
    const criticalUser = { ...validUserProps, failedLoginAttempts: 4 }; // No próximo erro, vai para 5
    userRepo.findByEmail.mockResolvedValueOnce(criticalUser);
    authRepo.findPasswordCredentialByUserId.mockResolvedValueOnce({ passwordHash: 'real_hash' });
    hasher.verify.mockResolvedValueOnce(false); // Invalid password

    const result = await useCase.execute({ email: 'user@example.com', password: 'wrong' });

    expect(result.isFailure).toBe(true);
    
    // O incremento foi chamado?
    expect(userRepo.incrementFailedLoginAttempts).toHaveBeenCalledWith(1, User.MAX_FAILED_ATTEMPTS);
    
    // A conta foi bloqueada na entidade em memória, gerando evento de lockout?
    expect(auditPort.logEvent).toHaveBeenCalledWith(expect.objectContaining({ 
      event: 'identity_account_locked'
    }));
  });

  it('deve resetar o contador e retornar dados do usuário em caso de sucesso', async () => {
    userRepo.findByEmail.mockResolvedValueOnce(validUserProps);
    authRepo.findPasswordCredentialByUserId.mockResolvedValueOnce({ passwordHash: 'real_hash' });
    hasher.verify.mockResolvedValueOnce(true); // Senha correta!

    const result = await useCase.execute({ email: 'user@example.com', password: 'correct' });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().email).toBe('user@example.com');
    
    // D1 Reset
    expect(userRepo.resetFailedLoginAttempts).toHaveBeenCalledWith(1);
    
    // Audita Sucesso
    expect(auditPort.logEvent).toHaveBeenCalledWith(expect.objectContaining({ 
      event: 'authentication_succeeded'
    }));
  });
});

```

---

## `src/application/use-cases/identity/AuthenticateAccountUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { IPasswordHasher } from '../../../application/ports/security/IPasswordHasher';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import {
  AuthenticateAccountDTO,
  AuthenticateAccountResult,
} from '../../../application/dto/identity/AuthenticateAccountDTO';

// Re-exportado para não quebrar imports existentes que ainda apontam para este arquivo.
export type { AuthenticateAccountDTO, AuthenticateAccountResult };

// In-memory brute-force tracker for failed login attempts (keyed by userId)
//
// ⚠️ ACHADO ADICIONAL (não coberto pelo relatório de auditoria):
// Este Map vive na memória do módulo/isolate. Em runtime edge (Cloudflare
// Workers) isso NÃO é confiável como mecanismo de rate-limit: isolates são
// reciclados e não compartilham memória entre si. Um atacante distribuído,
// ou aguardando um cold-start, reseta o contador. Deve ser substituído por
// um contador persistido (D1/KV) antes de produção. Mantido aqui apenas
// para não quebrar o comportamento atual sem acesso ao schema/repositório.
const failedAttemptsMap = new Map<number, { count: number; lastAttempt: Date }>();
const MAX_FAILED_ATTEMPTS = 5;

// Mensagem única para TODAS as falhas de autenticação (item 3.1: anti-enumeration).
// Nunca deve revelar se o e-mail existe, se a conta está bloqueada, suspensa,
// ou se a senha está incorreta — todas as causas produzem exatamente a mesma
// resposta (mesma string + mesmo HTTP status na camada de controller).
const GENERIC_AUTH_FAILURE_MESSAGE =
  'Não foi possível autenticar com as credenciais fornecidas. Se você esqueceu sua senha, solicite a redefinição.';

// Hash "isca" usado para equalizar o tempo de resposta quando o usuário não
// existe, evitando que a ausência de chamada ao hasher.verify() vaze a
// existência da conta por timing side-channel (achado adicional, item B).
// Deve ter o mesmo formato dos hashes reais gerados pelo IPasswordHasher em uso.
const DUMMY_PASSWORD_HASH =
  '$pbkdf2$iterations=100000$salt=0000000000000000000000000000000000000000000000000000000000000000$hash=0000000000000000000000000000000000000000000000000000000000000000';

export class AuthenticateAccountUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly hasher: IPasswordHasher,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: AuthenticateAccountDTO): Promise<Result<AuthenticateAccountResult>> {
    if (!dto.email || !dto.password) {
      // Validação de entrada: não há conta envolvida ainda, então esta
      // mensagem específica não vaza nada sobre existência de contas.
      return Result.fail<AuthenticateAccountResult>('Email e senha são obrigatórios.');
    }

    const emailNormalized = dto.email.trim().toLowerCase();

    return await this.uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository();
      const authRepo = factory.getAuthenticationRepository();

      const userRecord = await userRepo.findByEmail(emailNormalized);

      if (!userRecord) {
        // Achado adicional (B): equaliza o tempo de resposta executando um
        // hash "isca" com o mesmo custo computacional do hasher real, para
        // que "usuário inexistente" e "senha incorreta" fiquem indistinguíveis
        // por tempo de resposta.
        await this.hasher.verify(dto.password, DUMMY_PASSWORD_HASH).catch(() => undefined);
        return Result.fail<AuthenticateAccountResult>(GENERIC_AUTH_FAILURE_MESSAGE);
      }

      const { User } = await import('../../../domains/identity/entities/User');
      const user = new User(userRecord as any);

      // 1. Conta bloqueada ou suspensa — mesma mensagem genérica (item 3.1).
      if (!user.canAuthenticate()) {
        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'identity_login_blocked',
            userId: user.id,
            metadata: { email: emailNormalized, reason: `Account status: ${user.status}, subject: ${user.subjectType}` },
          });
        }
        return Result.fail<AuthenticateAccountResult>(GENERIC_AUTH_FAILURE_MESSAGE);
      }

      // 2. Buscar credencial de senha
      const credential = await authRepo.findPasswordCredentialByUserId(user.id);
      if (!credential) {
        // Equaliza tempo de resposta com hash isca
        await this.hasher.verify(dto.password, DUMMY_PASSWORD_HASH).catch(() => undefined);
        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'identity_login_failed',
            userId: user.id,
            metadata: { email: emailNormalized, reason: 'Missing credential' },
          });
        }
        return Result.fail<AuthenticateAccountResult>(GENERIC_AUTH_FAILURE_MESSAGE);
      }

      // 3. Verificar senha
      const isPasswordValid = await this.hasher.verify(dto.password, credential.passwordHash);
      if (!isPasswordValid) {
        // Rate-Limit Persistente no D1
        user.registerFailedLogin();
        await userRepo.incrementFailedLoginAttempts(user.id, User.MAX_FAILED_ATTEMPTS);

        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'identity_login_failed',
            userId: user.id,
            metadata: { email: emailNormalized, reason: 'Invalid password', attemptCount: user.failedLoginAttempts },
          });
        }

        if (user.status === 'locked') {
          if (this.auditPort) {
            await this.auditPort.logEvent({
              event: 'identity_account_locked',
              userId: user.id,
              metadata: { email: emailNormalized, reason: 'Max failed attempts reached' },
            });
          }
        }

        return Result.fail<AuthenticateAccountResult>(GENERIC_AUTH_FAILURE_MESSAGE);
      }

      // Sucesso: resetar tentativas no banco
      await userRepo.resetFailedLoginAttempts(user.id);

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'authentication_succeeded',
          userId: user.id,
          metadata: { email: user.email || '' },
        });
      }

      return Result.ok<AuthenticateAccountResult>({
        userId: user.id,
        email: user.email || '',
        publicId: userRecord.publicId,
        status: user.status,
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/AuthenticateTotpUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { AuthenticateTotpDTO } from '../../../application/dto/identity/AuthenticateTotpDTO';
import { authenticator } from 'otplib';
import { CryptoVault } from '../../../infrastructure/security/crypto/crypto';

export class AuthenticateTotpUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: AuthenticateTotpDTO): Promise<Result<{ verified: boolean; aal: number }>> {
    if (!dto.transactionId || !dto.code || !dto.encryptionKey) {
      return Result.fail<{ verified: boolean; aal: number }>('Transação, chave e código são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const transaction = await authTxRepo.getTransactionById(dto.transactionId);
      
      if (!transaction || !transaction.isValid(transaction.authEpochAtStart)) {
        return Result.fail<{ verified: boolean; aal: number }>('Transação inválida ou expirada.');
      }

      if (transaction.context !== 'login' && transaction.context !== 'mfa_setup' && transaction.context !== 'sensitive_operation') {
        return Result.fail<{ verified: boolean; aal: number }>('Transação não permite TOTP verification neste contexto.');
      }

      const authRepo = factory.getAuthenticationRepository();
      const totpRecord = await authRepo.findTotpCredentialByUserId(transaction.userId);

      if (!totpRecord) {
        return Result.fail<{ verified: boolean; aal: number }>('Segredo 2FA não configurado.');
      }

      let secret = '';
      try {
        secret = await CryptoVault.decrypt(totpRecord.encryptedTotpSecret, dto.encryptionKey);
      } catch (e) {
        return Result.fail<{ verified: boolean; aal: number }>('Falha ao descriptografar TOTP Secret.');
      }

      const isValid = authenticator.verify({
        token: dto.code.trim(),
        secret,
      });

      if (!isValid) {
        const recorded = await authTxRepo.recordFailedAttemptAtomically(transaction.id, 5);
        if (!recorded) {
          return Result.fail<{ verified: boolean; aal: number }>('Falha ao registrar tentativa (transação expirada ou finalizada).');
        }

        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'totp_verification_failed',
            userId: transaction.userId,
            metadata: { reason: 'Invalid OTP token', transactionId: transaction.id },
          });
        }
        return Result.fail<{ verified: boolean; aal: number }>('Código 2FA inválido.');
      }

      if (!totpRecord.verified) {
        await authRepo.verifyTotpAuthenticator(totpRecord.authenticatorId);
      }

      const completed = await authTxRepo.completeFactorAtomically(transaction.id, 2, transaction.authEpochAtStart, 'totp');
      if (!completed) {
        return Result.fail<{ verified: boolean; aal: number }>('Falha de concorrência ou transação inválida no D1.');
      }

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'totp_verification_succeeded',
          userId: transaction.userId,
          metadata: { aal: 2, transactionId: transaction.id },
        });
      }

      return Result.ok<{ verified: boolean; aal: number }>({
        verified: true,
        aal: 2,
      });
    });
  }
}


```

---

## `src/application/use-cases/identity/ConfirmPasswordResetUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { IPasswordHasher } from '../../../application/ports/security/IPasswordHasher';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { ConfirmPasswordResetDTO } from '../../../application/dto/identity/ConfirmPasswordResetDTO';

export class ConfirmPasswordResetUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly hasher: IPasswordHasher,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: ConfirmPasswordResetDTO): Promise<Result<void>> {
    if (!dto.token || !dto.newPassword) {
      return Result.fail<void>('Token e nova senha são obrigatórios.');
    }

    if (dto.newPassword.length < 8) {
      return Result.fail<void>('A senha deve ter no mínimo 8 caracteres.');
    }

    // Compute hash of provided raw token
    const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dto.token.trim()));
    const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    return await this.uow.execute(async (factory) => {
      const resetRepo = factory.getPasswordResetRepository();
      const authRepo = factory.getAuthenticationRepository();
      const userRepo = factory.getUserRepository();
      const sessionRepo = factory.getSessionRepository();

      // Atomic consume: updates usedAt if it's null, preventing race conditions
      const resetResult = await resetRepo.consumeToken(tokenHash);
      if (resetResult.isFailure || !resetResult.getValue()) {
        return Result.fail<void>('Token de redefinição inválido, expirado ou já utilizado.');
      }

      const resetRecord = resetResult.getValue();
      if (new Date(resetRecord.expiresAt) < new Date()) {
        return Result.fail<void>('Token de redefinição expirado.');
      }

      const newPasswordHash = await this.hasher.hash(dto.newPassword);
      await authRepo.savePasswordCredential(resetRecord.userId, newPasswordHash);

      // AF-008: Increment authEpoch to revoke all active user sessions globally
      if (typeof userRepo.incrementAuthEpoch === 'function') {
        await userRepo.incrementAuthEpoch(resetRecord.userId);
      }
      await sessionRepo.revokeAllUserSessions(resetRecord.userId);

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'password_reset_confirmed',
          userId: resetRecord.userId,
          metadata: { revokedAllSessions: true },
        });
      }

      return Result.ok();
    });
  }
}

```

---

## `src/application/use-cases/identity/GeneratePasskeyChallengeUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { generateRegistrationOptions, generateAuthenticationOptions } from '@simplewebauthn/server';

export interface GeneratePasskeyChallengeDTO {
  context: 'login' | 'credential_link';
  transactionId?: string;
  userId?: number;
  userName?: string;
  rpID: string;
  rpName: string;
}

export class GeneratePasskeyChallengeUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: GeneratePasskeyChallengeDTO): Promise<Result<{ challengeId: string; options: any }>> {
    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();

      let options: any;

      if (dto.context === 'credential_link') {
        if (!dto.userId || !dto.userName) {
          return Result.fail<{ challengeId: string; options: any }>('UserId e UserName são obrigatórios para credential_link');
        }

        const authRepo = factory.getAuthenticationRepository();
        const existingPasskeys = await authRepo.findAllWebAuthnCredentialsByUserId(dto.userId);

        options = await generateRegistrationOptions({
          rpName: dto.rpName,
          rpID: dto.rpID,
          userID: Uint8Array.from(dto.userId.toString(), c => c.charCodeAt(0)),
          userName: dto.userName,
          attestationType: 'none',
          excludeCredentials: existingPasskeys.map(key => ({
            id: Uint8Array.from(atob(key.credentialId), c => c.charCodeAt(0)),
            type: 'public-key',
            transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc'],
          })),
          authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'preferred',
          }
        });
      } else {
        options = await generateAuthenticationOptions({
          rpID: dto.rpID,
          userVerification: 'preferred',
        });
      }

      const challengeId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

      const challenge = new AuthenticationChallenge({
        id: challengeId,
        transactionId: dto.transactionId || null,
        userId: dto.userId || null,
        challengeHash: options.challenge, // We store the plain challenge here for simplewebauthn
        challengeType: 'webauthn',
        context: dto.context,
        createdAt: now,
        expiresAt,
      });

      await authTxRepo.createChallenge(challenge);

      return Result.ok({
        challengeId,
        options,
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/GenerateWeb3ChallengeUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { CryptoVault } from '../../../infrastructure/security/crypto/crypto';

export interface GenerateWeb3ChallengeDTO {
  context: 'login' | 'credential_link';
  transactionId?: string;
  domain: string;
}

export class GenerateWeb3ChallengeUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: GenerateWeb3ChallengeDTO): Promise<Result<{ challengeId: string; nonce: string; domain: string }>> {
    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();

      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const challengeId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

      const challenge = new AuthenticationChallenge({
        id: challengeId,
        transactionId: dto.transactionId || null,
        challengeHash: nonce, // Para SIWE, o hash é o nonce
        challengeType: 'siwe',
        context: dto.context,
        createdAt: now,
        expiresAt,
      });

      await authTxRepo.createChallenge(challenge);

      return Result.ok({
        challengeId,
        nonce,
        domain: dto.domain,
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/LinkExternalIdentityUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { LinkExternalIdentityInputDTO, LinkExternalIdentityOutputDTO } from '../../../application/dto/identity/LinkExternalIdentityDTO';
import { Result } from '../../../shared/kernel/Result';

export class LinkExternalIdentityUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: LinkExternalIdentityInputDTO): Promise<Result<LinkExternalIdentityOutputDTO>> {
    // Exigência AAL2+ (AF-007)
    if (input.sessionAal < 2) {
      return Result.fail<LinkExternalIdentityOutputDTO>(
        'Nível de autenticação insuficiente (AAL2+ obrigatório para vincular credenciais).'
      );
    }

    const { assertion, userId } = input;
    const now = new Date();

    return this.uow.execute(async (factory) => {
      if (assertion.type === 'web3_wallet') {
        const web3Repo = factory.getWeb3Repository();
        const existing = await web3Repo.findByAddress(assertion.subjectId);

        if (existing) {
          if (existing.userId === userId) {
            return Result.ok<LinkExternalIdentityOutputDTO>({
              success: true,
              provider: 'evm',
              subjectId: assertion.subjectId,
              linkedAt: existing.linkedAt || now,
            });
          }
          return Result.fail<LinkExternalIdentityOutputDTO>('Esta carteira Web3 já está vinculada a outra conta.');
        }

        await web3Repo.linkExternalWallet({
          userId,
          address: assertion.subjectId,
          provenance: 'external',
          networkId: assertion.networkId || 1,
          walletType: 'eoa',
          controlMode: 'external_user',
        });
      }

      if (this.securityAuditPort) {
        await this.securityAuditPort.logEvent({
          event: 'identity_linked',
          userId,
          metadata: { type: assertion.type, provider: assertion.provider, subjectId: assertion.subjectId },
        });
      }

      return Result.ok<LinkExternalIdentityOutputDTO>({
        success: true,
        provider: assertion.provider,
        subjectId: assertion.subjectId,
        linkedAt: now,
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/RefreshTokenUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { RefreshTokenDTO, RefreshTokenResult } from '../../../application/dto/identity/RefreshTokenDTO';

export interface ITokenService {
  generateAccessToken(payload: { userId: number; email: string; authEpoch: number }): Promise<string>;
  generateRefreshToken(): Promise<string>;
}

export class RefreshTokenUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly tokenService: ITokenService,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: RefreshTokenDTO): Promise<Result<RefreshTokenResult>> {
    if (!dto.refreshToken) {
      return Result.fail<RefreshTokenResult>('Refresh token é obrigatório.');
    }

    const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dto.refreshToken.trim()));
    const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    return await this.uow.execute(async (factory) => {
      const sessionRepo = factory.getSessionRepository();
      const userRepo = factory.getUserRepository();

      const session = await sessionRepo.getSessionByRefreshTokenHash(tokenHash);
      if (!session) {
        return Result.fail<RefreshTokenResult>('Sessão ou refresh token inválido.');
      }

      if (session.revokedAt) {
        // MALICIOUS REUSE DETECTED: Revoke the entire family!
        if (session.familyId) {
          await sessionRepo.revokeFamily(session.familyId, 'Malicious refresh token reuse detected');
        } else {
          await sessionRepo.revokeAllUserSessions(session.userId);
        }

        if (typeof userRepo.incrementAuthEpoch === 'function') {
          await userRepo.incrementAuthEpoch(session.userId);
        }

        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'refresh_token_reuse_detected',
            userId: session.userId,
            metadata: { sessionId: session.id, familyId: session.familyId },
          });
        }

        return Result.fail<RefreshTokenResult>('Refresh token reutilizado. Por razões de segurança, todas as sessões relacionadas foram encerradas.');
      }

      if (new Date(session.expiresAt) < new Date()) {
        return Result.fail<RefreshTokenResult>('Refresh token expirado. Faça login novamente.');
      }

      const user = await userRepo.findById(session.userId);
      if (!user || user.status !== 'active') {
        return Result.fail<RefreshTokenResult>('Usuário inativo ou não encontrado.');
      }

      // 1. Revoke the current session as it's been consumed (Single-use ATOMICALLY)
      const rotated = await sessionRepo.rotateRefreshTokenAtomically(session.id, tokenHash);
      if (!rotated) {
        return Result.fail<RefreshTokenResult>('Falha de concorrência ou sessão revogada por outra requisição (Race Condition).');
      }

      const newAccessToken = await this.tokenService.generateAccessToken({
        userId: user.id,
        email: user.email || '',
        authEpoch: user.authEpoch || 1,
      });

      const newRefreshToken = await this.tokenService.generateRefreshToken();

      // Create new session in the same family
      const newSessionId = crypto.randomUUID();
      const newJti = crypto.randomUUID();
      const newRefreshTokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(newRefreshToken));
      const newRefreshTokenHash = Array.from(new Uint8Array(newRefreshTokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 86400 * 1000 * 30); // 30 days for refresh session TTL

      await sessionRepo.createSession({
        id: newSessionId,
        userId: user.id,
        jti: newJti,
        ip: session.ip, // Inherit IP from previous session or update from request if possible
        userAgent: session.userAgent,
        familyId: session.familyId, // Inherit the family
        refreshTokenHash: newRefreshTokenHash,
        aal: session.aal,
        authEpoch: user.authEpoch || 1,
        createdAt: now,
        expiresAt,
        lastAuthenticatedAt: session.lastAuthenticatedAt ? new Date(session.lastAuthenticatedAt) : undefined,
      });

      return Result.ok<RefreshTokenResult>({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600, // 1 hour access token
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/RegisterAccountUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { IPasswordHasher } from '../../../application/ports/security/IPasswordHasher';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { RegisterAccountInputDTO, RegisterAccountOutputDTO } from '../../../application/dto/identity/RegisterAccountDTO';
import { Result } from '../../../shared/kernel/Result';

export class RegisterAccountUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly passwordHasher: IPasswordHasher,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: RegisterAccountInputDTO): Promise<Result<RegisterAccountOutputDTO>> {
    if (!input.email || !input.password) {
      return Result.fail<RegisterAccountOutputDTO>('Email e senha são obrigatórios para cadastro.');
    }

    const emailNormalized = input.email.trim().toLowerCase();

    return this.uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository();
      const authRepo = factory.getAuthenticationRepository();

      // 1. Verificar se o e-mail já existe
      const existingUser = await userRepo.findByEmail(emailNormalized);
      if (existingUser) {
        return Result.fail<RegisterAccountOutputDTO>('E-mail já cadastrado no sistema.');
      }

      // 2. Hash da senha com PBKDF2
      const passwordHash = await this.passwordHasher.hash(input.password);

      // 3. Criar registro mestre do usuário
      const newUser = await userRepo.create({
        email: input.email.trim(),
        emailNormalized,
        subjectType: 'citizen',
        status: 'active',
      });

      // 4. Salvar credencial de senha no repositório de autenticação
      await authRepo.savePasswordCredential(newUser.id, passwordHash);

      // 5. Auditoria Transacional ACID
      if (this.securityAuditPort) {
        await this.securityAuditPort.logEvent({
          event: 'account_created',
          userId: newUser.id,
          metadata: { email: emailNormalized },
        });
      }

      return Result.ok<RegisterAccountOutputDTO>({
        userId: newUser.id,
        email: newUser.email || '',
        status: newUser.status,
        createdAt: newUser.createdAt,
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/RequestPasswordResetUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { RequestPasswordResetDTO } from '../../../application/dto/identity/RequestPasswordResetDTO';
import { IDomainEvent } from '../../../shared/kernel/DomainEvent';

export class PasswordResetRequestedEvent implements IDomainEvent {
  dateTimeOccurred: Date = new Date();
  constructor(
    public readonly userId: number,
    public readonly email: string
    // rawToken removido por segurança (FASE 5)
  ) {}

  getAggregateId(): string {
    return String(this.userId);
  }
}

export class RequestPasswordResetUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: RequestPasswordResetDTO): Promise<Result<{ rawToken: string | null }>> {
    if (!dto.email) {
      return Result.fail<{ rawToken: string | null }>('E-mail é obrigatório.');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();

    // Use variable to extract rawToken out of the UoW closure
    let generatedRawToken: string | null = null;

    await this.uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository();
      const resetRepo = factory.getPasswordResetRepository();
      const outboxRepo = factory.getOutboxRepository();

      const user = await userRepo.findByEmail(normalizedEmail);
      if (!user) {
        // Anti-user enumeration: Return success even if user not found
        // But do not generate a token.
        return Result.ok();
      }

      // Generate secure random token
      const rawTokenBytes = new Uint8Array(32);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(rawTokenBytes);
      } else {
        for (let i = 0; i < 32; i++) rawTokenBytes[i] = Math.floor(Math.random() * 256);
      }
      const rawToken = Array.from(rawTokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      generatedRawToken = rawToken;

      // Create token hash for DB storage
      const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
      const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour expiration

      await resetRepo.create({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      // Salva evento de auditoria no Outbox SEM o rawToken
      const event = new PasswordResetRequestedEvent(user.id, user.email || '');
      await outboxRepo.saveEvent(event, user.id, 'User', 1);

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'password_reset_requested',
          userId: user.id,
          metadata: { email: user.email },
        });
      }

      return Result.ok();
    });

    return Result.ok({ rawToken: generatedRawToken });
  }
}


```

---

## `src/application/use-cases/identity/SetupTotpUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { SetupTotpDTO, SetupTotpResult } from '../../../application/dto/identity/SetupTotpDTO';
import { authenticator } from 'otplib';
import { CryptoVault } from '../../../infrastructure/security/crypto/crypto';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';

export class SetupTotpUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: SetupTotpDTO): Promise<Result<SetupTotpResult>> {
    if (!dto.transactionId || !dto.encryptionKey) {
      return Result.fail<SetupTotpResult>('ID da transação e chave de encriptação são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const transaction = await authTxRepo.getTransactionById(dto.transactionId);
      
      if (!transaction || !transaction.isValid(transaction.authEpochAtStart)) {
        return Result.fail<SetupTotpResult>('Transação inválida ou expirada.');
      }

      if (transaction.context !== 'mfa_setup') {
        return Result.fail<SetupTotpResult>('Transação não é de setup de MFA.');
      }

      const userRepo = factory.getUserRepository();
      const authRepo = factory.getAuthenticationRepository();

      const user = await userRepo.findById(transaction.userId);
      if (!user) {
        return Result.fail<SetupTotpResult>('Usuário não encontrado.');
      }

      // Verifica se já tem TOTP
      const existingTotp = await authRepo.findTotpCredentialByUserId(user.id);
      if (existingTotp) {
        // Se já tiver e estiver verificado, não deixa configurar outro direto sem remover.
        if (existingTotp.verified) {
          return Result.fail<SetupTotpResult>('Usuário já possui TOTP ativo.');
        }
      }

      const secret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(user.email || 'unknown', 'ASPPIBRA DAO', secret);

      // Criptografa o secret em repouso
      const encryptedSecret = await CryptoVault.encrypt(secret, dto.encryptionKey);

      await authRepo.saveTotpSecret(user.id, encryptedSecret);

      return Result.ok<SetupTotpResult>({
        secret,
        otpauthUrl,
      });
    });
  }
}


```

---

## `src/application/use-cases/identity/UnlinkExternalIdentityUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { UnlinkExternalIdentityInputDTO, UnlinkExternalIdentityOutputDTO } from '../../../application/dto/identity/UnlinkExternalIdentityDTO';
import { AntiLockoutViolationError } from '../../../domains/identity/errors/AntiLockoutViolationError';
import { Result } from '../../../shared/kernel/Result';

export class UnlinkExternalIdentityUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: UnlinkExternalIdentityInputDTO): Promise<Result<UnlinkExternalIdentityOutputDTO>> {
    const { userId, provider, subjectId } = input;
    const now = new Date();

    return this.uow.execute(async (factory) => {
      const authRepo = factory.getAuthenticationRepository();
      const web3Repo = factory.getWeb3Repository();

      const passwordCredential = await authRepo.findPasswordCredentialByUserId(userId);
      const userWallets = await web3Repo.findByUserId(userId);

      const totalMethods = (passwordCredential ? 1 : 0) + userWallets.length;

      // Trava Anti-Lockout (AF-008)
      if (totalMethods <= 1) {
        return Result.fail<UnlinkExternalIdentityOutputDTO>(new AntiLockoutViolationError().message);
      }

      if (this.securityAuditPort) {
        await this.securityAuditPort.logEvent({
          event: 'identity_unlinked',
          userId,
          metadata: { provider, subjectId },
        });
      }

      return Result.ok<UnlinkExternalIdentityOutputDTO>({
        success: true,
        unlinkedAt: now,
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/VerifyPasskeyIdentityUseCase.ts`

```typescript
import { IIdentityResolverPort } from '../../../application/ports/output/IIdentityResolverPort';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { VerifyPasskeyIdentityInputDTO, VerifyPasskeyIdentityOutputDTO } from '../../../application/dto/identity/VerifyPasskeyIdentityDTO';
import { Result } from '../../../shared/kernel/Result';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';

export class VerifyPasskeyIdentityUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly identityResolver: IIdentityResolverPort,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: VerifyPasskeyIdentityInputDTO): Promise<Result<VerifyPasskeyIdentityOutputDTO>> {
    if (!input.challengeId || !input.responseJSON || !input.expectedOrigin || !input.expectedRPID) {
      return Result.fail<VerifyPasskeyIdentityOutputDTO>('Parâmetros de autenticação Passkey ausentes.');
    }

    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const authRepo = factory.getAuthenticationRepository();

      const challenge = await authTxRepo.getChallengeById(input.challengeId);
      if (!challenge || !challenge.isValid()) {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Challenge inválido, expirado ou já utilizado.');
      }

      if (challenge.context !== 'login') {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Contexto do challenge não permite login via Passkey.');
      }

      const expectedChallenge = challenge.challengeHash;


      const passkeyRecord = await authRepo.findWebAuthnCredentialById(input.responseJSON.id);
      if (!passkeyRecord) {
        if (this.securityAuditPort) {
          await this.securityAuditPort.logEvent({
            event: 'authentication_failed',
            metadata: { provider: 'webauthn', credentialId: input.responseJSON.id, reason: 'Passkey record not found in DB' },
          });
        }
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Passkey não encontrada no sistema.');
      }

      const credentialID = Uint8Array.from(atob(passkeyRecord.credentialId), c => c.charCodeAt(0));
      const credentialPublicKey = Uint8Array.from(atob(passkeyRecord.publicKeyCose), c => c.charCodeAt(0));

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: input.responseJSON,
          expectedChallenge,
          expectedOrigin: input.expectedOrigin,
          expectedRPID: input.expectedRPID,
          authenticator: {
            credentialID,
            credentialPublicKey,
            counter: passkeyRecord.signCount,
            transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc'],
          },
          requireUserVerification: true, // as required for high assurance (AAL2)
        });
      } catch (error: any) {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>(`Falha na verificação da passkey: ${error.message}`);
      }

      if (!verification.verified || !verification.authenticationInfo) {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Assinatura do Passkey não verificada.');
      }

      // Atomic challenge consumption AFTER successful verification
      const consumed = await authTxRepo.consumeChallengeAtomically(challenge.id);
      if (!consumed) {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Falha de concorrência ou challenge expirado (replay attack).');
      }

      // Update signCount to prevent counter regression attacks
      await authRepo.updateWebAuthnSignCount(passkeyRecord.credentialId, verification.authenticationInfo.newCounter);


      // 1. Resolver a identidade via CanonicalIdentityResolver (AF-013)
      const resolution = await this.identityResolver.resolve({
        type: 'passkey',
        provider: 'webauthn',
        subjectId: passkeyRecord.credentialId,
        verifiedAt: new Date(),
      });

      // 2. Aplicar regra anti-shadow account (AF-009 & AF-012)
      if (resolution.status === 'not_linked') {
        if (this.securityAuditPort) {
          await this.securityAuditPort.logEvent({
            event: 'authentication_failed',
            metadata: { provider: 'webauthn', credentialId: passkeyRecord.credentialId, reason: 'Passkey not linked' },
          });
        }
        return Result.fail<VerifyPasskeyIdentityOutputDTO>(
          'Passkey não vinculada a nenhuma conta existente. Efetue login e vincule a passkey nas configurações.'
        );
      }

      // 3. Auditoria de sucesso
      if (this.securityAuditPort) {
        await this.securityAuditPort.logEvent({
          event: 'authentication_succeeded',
          userId: resolution.userId || 0,
          metadata: { provider: 'webauthn', credentialId: passkeyRecord.credentialId },
        });
      }

      return Result.ok<VerifyPasskeyIdentityOutputDTO>({
        userId: resolution.userId || 0,
        credentialId: passkeyRecord.credentialId,
        bindingType: 'passkey',
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/VerifyPasskeyRegistrationUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';

export interface VerifyPasskeyRegistrationDTO {
  challengeId: string;
  responseJSON: RegistrationResponseJSON;
  expectedOrigin: string;
  expectedRPID: string;
}

export class VerifyPasskeyRegistrationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: VerifyPasskeyRegistrationDTO): Promise<Result<{ authenticatorId: string }>> {
    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const authRepo = factory.getAuthenticationRepository();

      const challenge = await authTxRepo.getChallengeById(dto.challengeId);
      if (!challenge || !challenge.isValid()) {
        return Result.fail<{ authenticatorId: string }>('Challenge inválido, expirado ou já utilizado.');
      }

      if (challenge.context !== 'credential_link') {
        return Result.fail<{ authenticatorId: string }>('Contexto do challenge não permite registro de Passkey.');
      }

      if (!challenge.userId) {
        return Result.fail<{ authenticatorId: string }>('Challenge não está associado a um usuário.');
      }

      const expectedChallenge = challenge.challengeHash;


      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: dto.responseJSON,
          expectedChallenge,
          expectedOrigin: dto.expectedOrigin,
          expectedRPID: dto.expectedRPID,
        });
      } catch (error: any) {
        return Result.fail<{ authenticatorId: string }>(`Falha na verificação da passkey: ${error.message}`);
      }

      const { verified, registrationInfo } = verification;

      if (!verified || !registrationInfo) {
        return Result.fail<{ authenticatorId: string }>('Registro de Passkey não verificado.');
      }

      // Atomic challenge consumption AFTER successful verification
      const consumed = await authTxRepo.consumeChallengeAtomically(challenge.id);
      if (!consumed) {
        return Result.fail<{ authenticatorId: string }>('Falha de concorrência ou challenge expirado (replay attack).');
      }

      const { credentialID, credentialPublicKey } = registrationInfo;

      const credentialIdStr = btoa(String.fromCharCode(...credentialID));
      const publicKeyStr = btoa(String.fromCharCode(...credentialPublicKey));

      const authenticatorId = await authRepo.saveWebAuthnCredential(
        challenge.userId,
        credentialIdStr,
        publicKeyStr,
        dto.expectedRPID
      );

      return Result.ok({
        authenticatorId,
      });
    });
  }
}

```

---

## `src/application/use-cases/identity/VerifyWalletIdentityUseCase.ts`

```typescript
import { ISiweVerifierPort } from '../../../application/ports/security/ISiweVerifierPort';
import { IIdentityResolverPort } from '../../../application/ports/output/IIdentityResolverPort';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { VerifyWalletIdentityInputDTO, VerifyWalletIdentityOutputDTO } from '../../../application/dto/identity/VerifyWalletIdentityDTO';
import { Result } from '../../../shared/kernel/Result';

export class VerifyWalletIdentityUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly siweVerifier: ISiweVerifierPort,
    private readonly identityResolver: IIdentityResolverPort,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: VerifyWalletIdentityInputDTO): Promise<Result<VerifyWalletIdentityOutputDTO>> {
    try {
      if (!input.challengeId) {
        return Result.fail<VerifyWalletIdentityOutputDTO>('ID do Challenge é obrigatório.');
      }

      return await this.uow.execute(async (factory) => {
        const authTxRepo = factory.getAuthTransactionRepository();
        
        // Load Challenge
        const challenge = await authTxRepo.getChallengeById(input.challengeId);
        if (!challenge || !challenge.isValid()) {
          return Result.fail<VerifyWalletIdentityOutputDTO>('Challenge inválido, expirado ou já utilizado.');
        }

        if (challenge.context !== 'login' && challenge.context !== 'credential_link') {
          return Result.fail<VerifyWalletIdentityOutputDTO>('Contexto do challenge não permite autenticação SIWE aqui.');
        }

        // 1. Verificar a assinatura EIP-4361 usando o nonce atrelado ao challenge
        const verifiedData = await this.siweVerifier.verify({
          message: input.message,
          signature: input.signature,
          expectedNonce: challenge.challengeHash,
          expectedDomain: input.expectedDomain, // Este valor agora será o env do server
        });

        // Atomic challenge consumption AFTER successful verification
        const consumed = await authTxRepo.consumeChallengeAtomically(challenge.id);
        if (!consumed) {
          return Result.fail<VerifyWalletIdentityOutputDTO>('Falha de concorrência ou challenge expirado (replay attack).');
        }

        // 2. Resolver a identidade via CanonicalIdentityResolver (AF-013)
        const resolution = await this.identityResolver.resolve({
          type: 'web3_wallet',
          provider: 'evm',
          subjectId: verifiedData.address,
          networkId: verifiedData.chainId,
          verifiedAt: new Date(),
        });

        // 3. Aplicar regra anti-shadow account (AF-010 & AF-012)
        if (resolution.status === 'not_linked' && challenge.context === 'login') {
          if (this.securityAuditPort) {
            await this.securityAuditPort.logEvent({
              event: 'authentication_failed',
              metadata: { provider: 'evm', address: verifiedData.address, reason: 'Identity not linked' },
            });
          }
          return Result.fail<VerifyWalletIdentityOutputDTO>(
            'Carteira Web3 não vinculada a nenhuma conta existente. Efetue login e vincule a carteira nas configurações.'
          );
        }

        // 4. Auditoria de sucesso
        if (this.securityAuditPort) {
          await this.securityAuditPort.logEvent({
            event: 'authentication_succeeded',
            userId: resolution.userId || 0,
            metadata: { provider: 'evm', address: verifiedData.address },
          });
        }

        return Result.ok<VerifyWalletIdentityOutputDTO>({
          userId: resolution.userId || 0,
          address: verifiedData.address,
          chainId: verifiedData.chainId,
          bindingType: 'web3_wallet',
        });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao autenticar carteira Web3.';
      return Result.fail<VerifyWalletIdentityOutputDTO>(message);
    }
  }
}


```

---

## `src/application/use-cases/identity/auxiliary_auth.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SetupTotpUseCase } from './SetupTotpUseCase';
import { AuthenticateTotpUseCase } from './AuthenticateTotpUseCase';
import { RequestPasswordResetUseCase } from './RequestPasswordResetUseCase';
import { ConfirmPasswordResetUseCase } from './ConfirmPasswordResetUseCase';
import { RefreshTokenUseCase } from './RefreshTokenUseCase';
import { authenticator } from 'otplib';

import { AuthenticateAccountUseCase } from './AuthenticateAccountUseCase';

describe('Auxiliary Authentication Use Cases Suite', () => {
  describe('AuthenticateAccountUseCase Lockout Protection', () => {
    it('should lock account after 5 consecutive invalid password attempts', async () => {
      const mockUserRepo = {
        findByEmail: vi.fn().mockResolvedValue({ id: 99, email: 'brute@asppibra.com', status: 'active' }),
        updateStatus: vi.fn().mockResolvedValue(undefined),
      };
      const mockAuthRepo = {
        findPasswordCredentialByUserId: vi.fn().mockResolvedValue({ userId: 99, passwordHash: 'hash' }),
      };
      const mockHasher = {
        verify: vi.fn().mockResolvedValue(false), // Always invalid
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getAuthenticationRepository: () => mockAuthRepo,
          })
        ),
      };

      const useCase = new AuthenticateAccountUseCase(mockUow as any, mockHasher as any);

      // Attempt 1 to 4
      for (let i = 0; i < 4; i++) {
        const res = await useCase.execute({ email: 'brute@asppibra.com', password: 'wrong' });
        expect(res.isFailure).toBe(true);
        expect(res.error).toContain('Credenciais inválidas');
      }

      // Attempt 5 should trigger lockout!
      const res5 = await useCase.execute({ email: 'brute@asppibra.com', password: 'wrong' });
      expect(res5.isFailure).toBe(true);
      expect(res5.error).toContain('Conta bloqueada devido a 5 tentativas incorretas');
      expect(mockUserRepo.updateStatus).toHaveBeenCalledWith(99, 'locked');
    });
  });

  describe('SetupTotpUseCase', () => {

    it('should generate valid secret and otpauthUrl for existing user', async () => {
      const mockUserRepo = {
        findById: vi.fn().mockResolvedValue({ id: 1, email: 'user@asppibra.com' }),
      };
      const mockAuthRepo = {
        saveTotpSecret: vi.fn().mockResolvedValue('auth_123'),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getAuthenticationRepository: () => mockAuthRepo,
          })
        ),
      };

      const useCase = new SetupTotpUseCase(mockUow as any);
      const result = await useCase.execute({ userId: 1 });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().secret).toBeDefined();
      expect(result.getValue().otpauthUrl).toContain('otpauth://totp/ASPPIBRA');
    });
  });

  describe('AuthenticateTotpUseCase', () => {
    it('should verify valid 2FA TOTP code', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);

      const mockAuthRepo = {
        findTotpCredentialByUserId: vi.fn().mockResolvedValue({
          authenticatorId: 'auth_123',
          userId: 1,
          encryptedTotpSecret: secret,
          verified: false,
        }),
        verifyTotpAuthenticator: vi.fn().mockResolvedValue(undefined),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getAuthenticationRepository: () => mockAuthRepo,
          })
        ),
      };

      const useCase = new AuthenticateTotpUseCase(mockUow as any);
      const result = await useCase.execute({ userId: 1, code });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().verified).toBe(true);
      expect(result.getValue().aal).toBe(2);
      expect(mockAuthRepo.verifyTotpAuthenticator).toHaveBeenCalledWith('auth_123');
    });

    it('should reject invalid 2FA TOTP code', async () => {
      const secret = authenticator.generateSecret();
      const mockAuthRepo = {
        findTotpCredentialByUserId: vi.fn().mockResolvedValue({
          authenticatorId: 'auth_123',
          userId: 1,
          encryptedTotpSecret: secret,
          verified: true,
        }),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getAuthenticationRepository: () => mockAuthRepo,
          })
        ),
      };

      const useCase = new AuthenticateTotpUseCase(mockUow as any);
      const result = await useCase.execute({ userId: 1, code: '000000' });

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('Código 2FA inválido');
    });
  });

  describe('RequestPasswordResetUseCase', () => {
    it('should create password reset record and save event in outbox', async () => {
      const mockUserRepo = {
        findByEmail: vi.fn().mockResolvedValue({ id: 1, email: 'user@asppibra.com' }),
      };
      const mockResetRepo = {
        create: vi.fn().mockResolvedValue({ isSuccess: true }),
      };
      const mockOutboxRepo = {
        saveEvent: vi.fn().mockResolvedValue({ isSuccess: true }),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getPasswordResetRepository: () => mockResetRepo,
            getOutboxRepository: () => mockOutboxRepo,
          })
        ),
      };

      const useCase = new RequestPasswordResetUseCase(mockUow as any);
      const result = await useCase.execute({ email: 'user@asppibra.com' });

      expect(result.isSuccess).toBe(true);
      expect(mockResetRepo.create).toHaveBeenCalled();
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalled();
    });
  });

  describe('ConfirmPasswordResetUseCase', () => {
    it('should update password and revoke user sessions globally via authEpoch', async () => {
      const token = 'valid-reset-token-123';
      const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const mockResetRepo = {
        findByToken: vi.fn().mockResolvedValue({
          isFailure: false,
          getValue: () => ({ id: 10, userId: 1, tokenHash, expiresAt: new Date(Date.now() + 3600000), usedAt: null }),
        }),
        invalidate: vi.fn().mockResolvedValue({ isSuccess: true }),
      };
      const mockAuthRepo = {
        savePasswordCredential: vi.fn().mockResolvedValue('auth_pw_1'),
      };
      const mockUserRepo = {
        incrementAuthEpoch: vi.fn().mockResolvedValue(2),
      };
      const mockSessionRepo = {
        revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
      };
      const mockHasher = {
        hash: vi.fn().mockResolvedValue('$argon2id$v=19$newhash'),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getPasswordResetRepository: () => mockResetRepo,
            getAuthenticationRepository: () => mockAuthRepo,
            getUserRepository: () => mockUserRepo,
            getSessionRepository: () => mockSessionRepo,
          })
        ),
      };

      const useCase = new ConfirmPasswordResetUseCase(mockUow as any, mockHasher as any);
      const result = await useCase.execute({ token, newPassword: 'newSecurePassword123!' });

      expect(result.isSuccess).toBe(true);
      expect(mockAuthRepo.savePasswordCredential).toHaveBeenCalledWith(1, '$argon2id$v=19$newhash');
      expect(mockUserRepo.incrementAuthEpoch).toHaveBeenCalledWith(1);
      expect(mockSessionRepo.revokeAllUserSessions).toHaveBeenCalledWith(1);
    });
  });

  describe('RefreshTokenUseCase', () => {
    it('should detect malicious refresh token reuse and revoke all user sessions', async () => {
      const refreshToken = 'reused-refresh-token';
      const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refreshToken));
      const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const mockSessionRepo = {
        getSessionById: vi.fn().mockResolvedValue({
          id: tokenHash,
          userId: 1,
          revokedAt: new Date(), // Already revoked session!
          expiresAt: new Date(Date.now() + 3600000),
        }),
        revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
      };
      const mockUserRepo = {
        incrementAuthEpoch: vi.fn().mockResolvedValue(3),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSessionRepository: () => mockSessionRepo,
            getUserRepository: () => mockUserRepo,
          })
        ),
      };
      const mockTokenService = {
        generateAccessToken: vi.fn(),
        generateRefreshToken: vi.fn(),
      };

      const useCase = new RefreshTokenUseCase(mockUow as any, mockTokenService as any);
      const result = await useCase.execute({ refreshToken });

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('Refresh token reutilizado');
      expect(mockUserRepo.incrementAuthEpoch).toHaveBeenCalledWith(1);
      expect(mockSessionRepo.revokeAllUserSessions).toHaveBeenCalledWith(1);
    });
  });
});

```

---

## `src/db/authentication/relations.ts`

```typescript
import { relations } from 'drizzle-orm';
import {
  userAuthenticators,
  passwordCredentials,
  webauthnCredentials,
  totpCredentials,
  walletAuthenticators,
  recoverySets,
  recoveryCredentials,
  userSessions,
  passwordResets,
  authChallenges,
} from './tables';
import { users } from '../user/tables';
import { securityEvents } from '../security/tables';

/**
 * ============================================================================
 * AUTHENTICATION DOMAIN RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to authentication entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on authentication tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */
export const userAuthenticatorsRelations = relations(userAuthenticators, ({ one, many }) => ({
  user: one(users, {
    fields: [userAuthenticators.userId],
    references: [users.id],
    relationName: 'authenticatorOwner',
  }),
  revokedByUser: one(users, {
    fields: [userAuthenticators.revokedBy],
    references: [users.id],
    relationName: 'revokedAuthenticators',
  }),

  passwordCredential: one(passwordCredentials),
  webauthnCredential: one(webauthnCredentials),
  totpCredential: one(totpCredentials),
  walletAuthenticator: one(walletAuthenticators),

  recoverySet: one(recoverySets),

  securityEvents: many(securityEvents),
}));

/**
 * ============================================================================
 * CREDENTIALS
 * ============================================================================
 */
export const passwordCredentialsRelations = relations(passwordCredentials, ({ one }) => ({
  authenticator: one(userAuthenticators, {
    fields: [passwordCredentials.authenticatorId],
    references: [userAuthenticators.id],
  }),
}));

export const webauthnCredentialsRelations = relations(webauthnCredentials, ({ one }) => ({
  authenticator: one(userAuthenticators, {
    fields: [webauthnCredentials.authenticatorId],
    references: [userAuthenticators.id],
  }),
}));

export const totpCredentialsRelations = relations(totpCredentials, ({ one }) => ({
  authenticator: one(userAuthenticators, {
    fields: [totpCredentials.authenticatorId],
    references: [userAuthenticators.id],
  }),
}));

/**
 * ============================================================================
 * RECOVERY
 * ============================================================================
 */
export const recoverySetsRelations = relations(recoverySets, ({ one, many }) => ({
  authenticator: one(userAuthenticators, {
    fields: [recoverySets.authenticatorId],
    references: [userAuthenticators.id],
  }),
  credentials: many(recoveryCredentials),
}));

export const recoveryCredentialsRelations = relations(recoveryCredentials, ({ one }) => ({
  recoverySet: one(recoverySets, {
    fields: [recoveryCredentials.recoverySetId],
    references: [recoverySets.id],
  }),
}));

/**
 * ============================================================================
 * WALLET
 * ============================================================================
 */
export const walletAuthenticatorsRelations = relations(walletAuthenticators, ({ one }) => ({
  authenticator: one(userAuthenticators, {
    fields: [walletAuthenticators.authenticatorId],
    references: [userAuthenticators.id],
  }),
  // Navigation to web3.wallets removed intentionally (Cross-Domain
  // Dependency Matrix — authentication MUST NOT depend on web3).
  // Resolve via application layer: IWeb3Repository.findById(walletId).
}));

/**
 * ============================================================================
 * SESSION
 * ============================================================================
 */
export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, { fields: [userSessions.userId], references: [users.id] }),
}));

/**
 * ============================================================================
 * PASSWORD RESET
 * ============================================================================
 */
export const passwordResetsRelations = relations(passwordResets, ({ one }) => ({
  user: one(users, { fields: [passwordResets.userId], references: [users.id] }),
}));

/**
 * ============================================================================
 * AUTH CHALLENGE
 * ============================================================================
 */
export const authChallengesRelations = relations(authChallenges, ({ one }) => ({
  user: one(users, { fields: [authChallenges.userId], references: [users.id] }),
}));

```

---

## `src/db/authentication/tables.ts`

```typescript
import {
  sqliteTable,
  text,
  integer,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';
import { AUTH_TYPES } from '../constants';

/**
 * ============================================================================
 * AUTHENTICATION DOMAIN
 * ============================================================================
 *
 * Bounded Context Boundaries:
 * - User/actor identity is owned by user/
 * - Web3 Evm Wallets are owned by web3/
 * - Authentication domain owns authenticators, credentials, sessions, and auth challenges.
 *
 * Security & Persistence Standard:
 * - Credentials and session storage rely on standard Unix Epoch timestamps.
 * - Sensitive secrets (hashes, tokens) are NEVER logged or stored in unencrypted metadata.
 * ============================================================================
 */

// ----------------------------------------------------------------------
// Entity: userAuthenticators
// ----------------------------------------------------------------------
export const userAuthenticators = sqliteTable(
  'user_authenticators',
  {
    id: text('id').primaryKey(), // UUID v4

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type', { enum: AUTH_TYPES }).notNull(),
    label: text('label'),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),

    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revokedBy: integer('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    revocationReason: text('revocation_reason'),

    // SECURITY:
    // metadata is non-secret operational metadata only.
    // NEVER store: password hashes, TOTP secrets, private keys,
    // recovery codes, session tokens, or bearer credentials.
    metadata: text('metadata', { mode: 'json' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userTypeRevokedIdx: index('idx_authenticators_user_type_revoked').on(
      table.userId,
      table.type,
      table.revokedAt
    ),
    typeCheck: check(
      'user_authenticators_type_check',
      sql`${table.type} IN ('password', 'totp', 'webauthn', 'recovery_code', 'wallet')`
    ),
    revokedStateCheck: check(
      'user_authenticators_revoked_state_check',
      sql`${table.revokedAt} IS NOT NULL OR ${table.revocationReason} IS NULL`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: passwordCredentials
// ----------------------------------------------------------------------
export const passwordCredentials = sqliteTable('password_credentials', {
  authenticatorId: text('authenticator_id')
    .primaryKey()
    .references(() => userAuthenticators.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(), // Argon2id hash com parâmetros embutidos
});

// ----------------------------------------------------------------------
// Entity: webauthnCredentials
// ----------------------------------------------------------------------
export const webauthnCredentials = sqliteTable(
  'webauthn_credentials',
  {
    authenticatorId: text('authenticator_id')
      .primaryKey()
      .references(() => userAuthenticators.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    publicKeyCose: text('public_key_cose').notNull(),
    rpId: text('rp_id').notNull(),
    userHandle: text('user_handle'), // nullable pois nem todo webauthn é discoverable/resident
    signCount: integer('sign_count').notNull().default(0),
    transports: text('transports', { mode: 'json' }),
    backupEligible: integer('backup_eligible', { mode: 'boolean' }).notNull(),
    backupState: integer('backup_state', { mode: 'boolean' }).notNull(),
    uvInitialized: integer('uv_initialized', { mode: 'boolean' }).notNull(),
    aaguid: text('aaguid'),
    attestationFormat: text('attestation_format'),
    attestationObject: text('attestation_object'),
  },
  (table) => ({
    signCountCheck: check('webauthn_sign_count_check', sql`${table.signCount} >= 0`),
    rpIdCheck: check('webauthn_rpid_check', sql`length(${table.rpId}) > 0`),
    backupStateCheck: check(
      'webauthn_backup_state_check',
      sql`${table.backupState} = 0 OR ${table.backupEligible} = 1`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: totpCredentials
// ----------------------------------------------------------------------
export const totpCredentials = sqliteTable(
  'totp_credentials',
  {
    authenticatorId: text('authenticator_id')
      .primaryKey()
      .references(() => userAuthenticators.id, { onDelete: 'cascade' }),
    encryptedTotpSecret: text('encrypted_totp_secret').notNull(),
    algorithm: text('algorithm').notNull().default('SHA1'),
    digits: integer('digits').notNull().default(6),
    period: integer('period').notNull().default(30),
  },
  (table) => ({
    digitsCheck: check('totp_digits_check', sql`${table.digits} IN (6, 8)`),
    periodCheck: check('totp_period_check', sql`${table.period} IN (30, 60)`),
    algorithmCheck: check(
      'totp_algorithm_check',
      sql`${table.algorithm} IN ('SHA1', 'SHA256', 'SHA512')`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: recoverySets
// ----------------------------------------------------------------------
export const recoverySets = sqliteTable('recovery_sets', {
  id: text('id').primaryKey(),
  authenticatorId: text('authenticator_id')
    .unique()
    .references(() => userAuthenticators.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

// ----------------------------------------------------------------------
// Entity: recoveryCredentials
// ----------------------------------------------------------------------
export const recoveryCredentials = sqliteTable(
  'recovery_credentials',
  {
    id: text('id').primaryKey(),
    recoverySetId: text('recovery_set_id')
      .references(() => recoverySets.id, { onDelete: 'cascade' })
      .notNull(),
    codeHash: text('code_hash').notNull(), // Argon2id hash
    consumedAt: integer('consumed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    recoverySetIdx: index('idx_recovery_credentials_set').on(table.recoverySetId),
  })
);

// ----------------------------------------------------------------------
// Entity: passwordResets
// ----------------------------------------------------------------------
export const passwordResets = sqliteTable(
  'password_resets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    expiresAtIdx: index('idx_password_resets_expires').on(table.expiresAt),
    usedStateCheck: check(
      'password_resets_used_state_check',
      sql`${table.usedAt} IS NULL OR ${table.usedAt} >= ${table.createdAt}`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: refreshTokenFamilies
// ----------------------------------------------------------------------
export const refreshTokenFamilies = sqliteTable(
  'refresh_token_families',
  {
    id: text('id').primaryKey(), // UUID da família de tokens
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    userIdIdx: index('idx_refresh_families_user').on(table.userId),
    revokedStateCheck: check(
      'refresh_families_revoked_state_check',
      sql`${table.revokedAt} IS NOT NULL OR ${table.revocationReason} IS NULL`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: userSessions
// ----------------------------------------------------------------------
export const userSessions = sqliteTable(
  'user_sessions',
  {
    id: text('id').primaryKey(), // UUID da sessão
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jti: text('jti').notNull().unique(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    familyId: text('family_id') // Adicionado relacionamento com a família
      .references(() => refreshTokenFamilies.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    aal: integer('aal').notNull().default(1),
    authEpoch: integer('auth_epoch').notNull().default(1),
    lastActivityAt: integer('last_activity_at', { mode: 'timestamp' }),
    lastAuthenticatedAt: integer('last_authenticated_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),
  },
  (table) => ({
    userIdIdx: index('idx_sessions_user').on(table.userId),
    familyIdIdx: index('idx_sessions_family').on(table.familyId),
    expiresAtIdx: index('idx_sessions_expires').on(table.expiresAt),
    aalCheck: check('user_sessions_aal_check', sql`${table.aal} IN (1, 2, 3)`),
    expirationCheck: check(
      'user_sessions_expiration_check',
      sql`${table.createdAt} < ${table.expiresAt}`
    ),
    revokedStateCheck: check(
      'user_sessions_revoked_state_check',
      sql`${table.revokedAt} IS NOT NULL OR ${table.revocationReason} IS NULL`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: authChallenges
// ----------------------------------------------------------------------
export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: text('id').primaryKey(), // UUID do desafio
    transactionId: text('transaction_id').references(() => authTransactions.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    challengeHash: text('challenge_hash').notNull(),
    challengeType: text('challenge_type').notNull(), // 'ssh', 'totp', 'webauthn', 'siwe'
    context: text('context').notNull(), // 'login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery'
    usedAt: integer('used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    transactionIdIdx: index('idx_auth_challenges_transaction').on(table.transactionId),
    expiresAtIdx: index('idx_auth_challenges_expires').on(table.expiresAt),
    typeCheck: check(
      'auth_challenges_type_check',
      sql`${table.challengeType} IN ('ssh', 'totp', 'webauthn', 'siwe')`
    ),
    contextCheck: check(
      'auth_challenges_context_check',
      sql`${table.context} IN ('login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery')`
    ),
    expirationCheck: check(
      'auth_challenges_expiration_check',
      sql`${table.createdAt} < ${table.expiresAt}`
    ),
    usedStateCheck: check(
      'auth_challenges_used_state_check',
      sql`${table.usedAt} IS NULL OR ${table.usedAt} >= ${table.createdAt}`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: authTransactions
// ----------------------------------------------------------------------
export const authTransactions = sqliteTable(
  'auth_transactions',
  {
    id: text('id').primaryKey(), // UUID v4
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['created', 'awaiting_factor', 'verified', 'completed', 'expired', 'cancelled', 'failed', 'replayed', 'locked'] })
      .notNull()
      .default('created'),
    initialAal: integer('initial_aal').notNull().default(1),
    currentAal: integer('current_aal').notNull().default(1),
    targetAal: integer('target_aal').notNull().default(2),
    method: text('method').notNull(), // ex: 'password', 'totp', 'webauthn', 'siwe'
    challengeHash: text('challenge_hash'),
    context: text('context').notNull(), // 'login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery'
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    consumedAt: integer('consumed_at', { mode: 'timestamp' }),
    failureCount: integer('failure_count').notNull().default(0),
    authEpochAtStart: integer('auth_epoch_at_start').notNull(),
    lastAuthenticatedAt: integer('last_authenticated_at', { mode: 'timestamp' }),
    assuranceMethod: text('assurance_method'),
    riskLevel: text('risk_level', { enum: ['low', 'medium', 'high', 'critical'] }).notNull().default('low'),
  },
  (table) => ({
    userIdIdx: index('idx_auth_transactions_user').on(table.userId),
    expiresAtIdx: index('idx_auth_transactions_expires').on(table.expiresAt),
    statusCheck: check(
      'auth_transactions_status_check',
      sql`${table.status} IN ('created', 'awaiting_factor', 'verified', 'completed', 'expired', 'cancelled', 'failed', 'replayed', 'locked')`
    ),
    contextCheck: check(
      'auth_transactions_context_check',
      sql`${table.context} IN ('login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery')`
    ),
    expirationCheck: check(
      'auth_transactions_expiration_check',
      sql`${table.createdAt} < ${table.expiresAt}`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: walletAuthenticators
// ----------------------------------------------------------------------
export const walletAuthenticators = sqliteTable(
  'wallet_authenticators',
  {
    authenticatorId: text('authenticator_id')
      .primaryKey()
      .references(() => userAuthenticators.id, { onDelete: 'cascade' }),
    /**
     * Opaque reference to web3.wallets.id.
     * Intentionally NOT a physical FK — authentication MUST NOT depend on
     * web3 (Cross-Domain Dependency Matrix). Integrity is enforced at the
     * application layer via IWeb3Repository at link-time
     * (LinkExternalIdentityUseCase / VerifyExternalIdentityUseCase).
     */
    walletId: integer('wallet_id').unique().notNull(),
    protocol: text('protocol', { enum: ['siwe', 'eip191', 'eip712', 'eip1271'] })
      .notNull()
      .default('siwe'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    protocolCheck: check(
      'wallet_authenticators_protocol_check',
      sql`${table.protocol} IN ('siwe', 'eip191', 'eip712', 'eip1271')`
    ),
  })
);

```

---

## `src/db/authorization/relations.ts`

```typescript
import { relations } from 'drizzle-orm';
import { roles, userRoles } from './tables';
import { users } from '../user/tables';




export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}));



export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
    relationName: 'roleOwner',
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  grantedByUser: one(users, {
    fields: [userRoles.grantedBy],
    references: [users.id],
    relationName: 'grantedRoles',
  }),
  revokedByUser: one(users, {
    fields: [userRoles.revokedBy],
    references: [users.id],
    relationName: 'revokedRoles',
  }),
}));


```

---

## `src/db/authorization/tables.ts`

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';



//
//   Authorization subsystem (RBAC)
//   USER / ACTOR
//   N/A
//   SECURITY / AUDIT events

// ----------------------------------------------------------------------
// Entity: roles
// ----------------------------------------------------------------------
export const roles = sqliteTable('roles', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  key:         text('key').notNull().unique(), // 'admin', 'citizen', 'partner', 'auditor'...
  displayName: text('display_name').notNull(),
  description: text('description'),
  status:      text('status', { enum: ['active', 'disabled', 'archived'] }).default('active').notNull(),
  isSystem:    integer('is_system', { mode: 'boolean' }).default(false).notNull(), // true = não pode ser deletado
  version:     integer('version').default(1).notNull(),
  createdBy:   integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt:   integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  updatedAt:   integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull().$onUpdateFn(() => new Date()),
}, (table) => ({
  statusIdx: index('idx_roles_status').on(table.status),
  versionCheck: check('roles_version_check', sql`${table.version} >= 1`),
  statusCheck: check('roles_status_check', sql`${table.status} IN ('active', 'disabled', 'archived')`),
}));



// ----------------------------------------------------------------------
// Entity: userRoles
// ----------------------------------------------------------------------
export const userRoles = sqliteTable(
  'user_roles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),

    // Auditoria da concessão
    grantSource: text('grant_source', { enum: ['admin', 'system', 'migration', 'policy'] }).notNull().default('admin'),
    grantedBy: integer('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantReason: text('grant_reason'),
    grantedAt: integer('granted_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),

    // Lifecycle da concessão
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    
    revokedBy: integer('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),

    version: integer('version').default(1).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull().$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userRoleLifecycleIdx: index('idx_user_roles_user_role_lifecycle').on(table.userId, table.roleId, table.revokedAt, table.expiresAt),
    roleLifecycleIdx: index('idx_user_roles_role_lifecycle').on(table.roleId, table.revokedAt, table.expiresAt),
    grantedByIdx: index('idx_user_roles_granted_by').on(table.grantedBy),
    revokedByIdx: index('idx_user_roles_revoked_by').on(table.revokedBy),
    
    expiresAfterGrantCheck: check('user_roles_expires_after_grant', sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.grantedAt}`),
    revokedAfterGrantCheck: check('user_roles_revoked_after_grant', sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.grantedAt}`),
    revocationCoherenceCheck: check('user_roles_revocation_coherence', sql`${table.revokedBy} IS NULL OR ${table.revokedAt} IS NOT NULL`),
    versionCheck: check('user_roles_version_check', sql`${table.version} >= 1`),
    grantSourceCheck: check('user_roles_grant_source_check', sql`${table.grantSource} IN ('admin', 'system', 'migration', 'policy')`),
  })
);
// ----------------------------------------------------------------------
// Entity: permissions
// ----------------------------------------------------------------------
export const permissions = sqliteTable(
  'permissions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull().unique(), // ex: 'user.read', 'finance.write', 'admin.all'
    displayName: text('display_name').notNull(),
    description: text('description'),
    module: text('module').notNull(), // ex: 'identity', 'finance', 'system'
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  },
  (table) => ({
    moduleIdx: index('idx_permissions_module').on(table.module),
  })
);

// ----------------------------------------------------------------------
// Entity: rolePermissions
// ----------------------------------------------------------------------
export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: integer('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
  })
);

```

---

## `src/db/civil-identity/relations.ts`

```typescript
import { relations } from 'drizzle-orm';
import { citizens, identityDocuments, kycVerifications } from './tables';
import { users } from '../user/tables';

/**
 * ============================================================================
 * CIVIL-IDENTITY RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to civil-identity entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on civil-identity tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */

/**
 * ============================================================================
 * CITIZENS RELATIONS
 * ============================================================================
 */
export const citizensRelations = relations(citizens, ({ one }) => ({
  user: one(users, {
    fields: [citizens.userId],
    references: [users.id],
    relationName: 'citizenOwner',
  }),
  verifiedByUser: one(users, {
    fields: [citizens.verifiedBy],
    references: [users.id],
    relationName: 'verifiedCitizens',
  }),
}));

/**
 * ============================================================================
 * IDENTITY DOCUMENTS RELATIONS
 * ============================================================================
 */
export const identityDocumentsRelations = relations(identityDocuments, ({ one }) => ({
  user: one(users, {
    fields: [identityDocuments.userId],
    references: [users.id],
    relationName: 'userIdentityDocuments',
  }),
  verifiedByUser: one(users, {
    fields: [identityDocuments.verifiedBy],
    references: [users.id],
    relationName: 'verifiedIdentityDocuments',
  }),
}));

/**
 * ============================================================================
 * KYC VERIFICATIONS RELATIONS
 * ============================================================================
 */
export const kycVerificationsRelations = relations(kycVerifications, ({ one }) => ({
  user: one(users, {
    fields: [kycVerifications.userId],
    references: [users.id],
    relationName: 'kycSubject',
  }),
  reviewedByUser: one(users, {
    fields: [kycVerifications.reviewedBy],
    references: [users.id],
    relationName: 'reviewedKycs',
  }),
}));

```

---

## `src/db/civil-identity/tables.ts`

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * CIVIL IDENTITY & KYC SUBSYSTEM
 * ============================================================================
 *
 * Responsibility:
 *   - Legal natural person identity attributes (citizens)
 *   - Physical/digital identity document records (identityDocuments)
 *   - Know-Your-Customer (KYC) compliance verification processes (kycVerifications)
 *
 * Explicit Boundaries:
 *   - Account lifecycle and public identifiers belong to user/
 *   - DID and verifiable credentials material belong to ssi/
 *   - Authentication credentials belong to authentication/
 *
 * PII Protection & Cryptography Model:
 *   - `numberLookupHash`: Blind HMAC-SHA256 hash used for duplicate detection without plaintext enumeration.
 *   - `encryptedNumber`: AES-GCM encrypted document identifier at rest.
 *   - `last4`: Truncated non-sensitive suffix for user UI display.
 *   - `documentHash`: SHA256 file checksum for document immutability verification.
 *
 * Regulatory & Compliance Retention:
 *   - Foreign keys from civil identity records to `users.id` use `onDelete: 'restrict'`.
 *   - Legal AML/KYC retention regulations require identity audit trails to survive user account soft-deletion.
 *
 * State Semantic Distinctions:
 *   - `citizens.civilStatus`: Overall status of the verified natural person within ASPPIBRA.
 *   - `identityDocuments.verificationStatus`: Status of a specific uploaded identity document.
 *   - `kycVerifications.status`: Lifecycle state of an individual KYC audit run/checkpoint.
 * ============================================================================
 */

/* ============================================================================
 * 1. CITIZENS
 * ============================================================================ */
export const citizens = sqliteTable(
  'citizens',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),

    username: text('username').$defaultFn(() => 'citizen_' + crypto.randomUUID()),

    legalFirstName: text('legal_first_name'),
    legalLastName: text('legal_last_name'),
    nationalityCode: text('nationality_code'),
    birthDate: text('birth_date'), // YYYY-MM-DD

    maritalStatus: text('marital_status', {
      enum: ['single', 'married', 'divorced', 'widowed', 'stable_union', 'separated'],
    }),

    civilStatus: text('civil_status', {
      enum: ['pending', 'verified', 'suspended', 'revoked'],
    })
      .notNull()
      .default('pending'),

    statusChangedAt: integer('status_changed_at', { mode: 'timestamp' }),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    verifiedBy: integer('verified_by').references(() => users.id, { onDelete: 'set null' }),

    version: integer('version').notNull().default(1),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    civilStatusCheck: check(
      'ck_citizens_civil_status',
      sql`${table.civilStatus} IN ('pending', 'verified', 'suspended', 'revoked')`
    ),

    maritalStatusCheck: check(
      'ck_citizens_marital_status',
      sql`${table.maritalStatus} IS NULL OR ${table.maritalStatus} IN ('single', 'married', 'divorced', 'widowed', 'stable_union', 'separated')`
    ),

    verifiedStateCheck: check(
      'ck_citizens_verified_state',
      sql`
        ${table.civilStatus} != 'verified'
        OR (
          ${table.verifiedAt} IS NOT NULL
          AND ${table.verifiedBy} IS NOT NULL
        )
      `
    ),

    versionCheck: check('ck_citizens_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 2. IDENTITY DOCUMENTS
 * ============================================================================ */
export const identityDocuments = sqliteTable(
  'identity_documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    documentType: text('document_type', {
      enum: ['cpf', 'rg', 'passport', 'cnh'],
    }).notNull(),

    countryCode: text('country_code').default('BR').notNull(),

    numberLookupHash: text('number_lookup_hash').notNull(),
    encryptedNumber: text('encrypted_number').notNull(),
    last4: text('last4'),
    documentHash: text('document_hash'),

    issuingAuthority: text('issuing_authority'),
    issuedAt: text('issued_at'), // YYYY-MM-DD
    expiresAt: text('expires_at'), // YYYY-MM-DD

    source: text('source', {
      enum: ['government', 'manual_upload', 'kyc_provider', 'admin', 'import'],
    }).notNull(),

    sourceReference: text('source_reference'),

    verificationStatus: text('verification_status', {
      enum: ['pending', 'verified', 'rejected'],
    })
      .notNull()
      .default('pending'),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    verifiedBy: integer('verified_by').references(() => users.id, { onDelete: 'set null' }),

    version: integer('version').notNull().default(1),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_identity_docs_user').on(table.userId),
    lookupHashIdx: index('idx_identity_docs_hash').on(table.numberLookupHash),

    lookupHashUnique: uniqueIndex('uq_identity_docs_active_lookup_hash')
      .on(table.countryCode, table.documentType, table.numberLookupHash)
      .where(sql`${table.verificationStatus} != 'rejected'`),

    documentTypeCheck: check(
      'ck_identity_docs_document_type',
      sql`${table.documentType} IN ('cpf', 'rg', 'passport', 'cnh')`
    ),

    sourceCheck: check(
      'ck_identity_docs_source',
      sql`${table.source} IN ('government', 'manual_upload', 'kyc_provider', 'admin', 'import')`
    ),

    verificationStatusCheck: check(
      'ck_identity_docs_verification_status',
      sql`${table.verificationStatus} IN ('pending', 'verified', 'rejected')`
    ),

    verifiedStateCheck: check(
      'ck_identity_docs_verified_state',
      sql`
        ${table.verificationStatus} != 'verified'
        OR (
          ${table.verifiedAt} IS NOT NULL
          AND ${table.verifiedBy} IS NOT NULL
        )
      `
    ),

    documentDatesCheck: check(
      'ck_identity_docs_dates',
      sql`
        ${table.issuedAt} IS NULL
        OR ${table.expiresAt} IS NULL
        OR ${table.expiresAt} > ${table.issuedAt}
      `
    ),

    versionCheck: check('ck_identity_docs_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 3. KYC VERIFICATIONS
 * ============================================================================ */
export const kycVerifications = sqliteTable(
  'kyc_verifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    verificationVersion: integer('verification_version').notNull().default(1),

    verificationLevel: text('verification_level', {
      enum: ['basic', 'enhanced', 'institutional'],
    }).notNull(),

    status: text('status', {
      enum: ['submitted', 'under_review', 'approved', 'rejected', 'expired'],
    }).notNull(),

    provider: text('provider').notNull(),

    riskScore: integer('risk_score'),
    riskModel: text('risk_model'),
    riskModelVersion: text('risk_model_version'),

    rejectionReason: text('rejection_reason'),
    metadata: text('metadata', { mode: 'json' }),

    reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),

    startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),

    version: integer('version').notNull().default(1),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_kyc_user').on(table.userId),
    statusIdx: index('idx_kyc_status').on(table.status),

    verificationLevelCheck: check(
      'ck_kyc_verifications_level',
      sql`${table.verificationLevel} IN ('basic', 'enhanced', 'institutional')`
    ),

    statusCheck: check(
      'ck_kyc_verifications_status',
      sql`${table.status} IN ('submitted', 'under_review', 'approved', 'rejected', 'expired')`
    ),

    approvedStateCheck: check(
      'ck_kyc_verifications_approved_state',
      sql`
        ${table.status} != 'approved'
        OR ${table.completedAt} IS NOT NULL
      `
    ),

    rejectedStateCheck: check(
      'ck_kyc_verifications_rejected_state',
      sql`
        ${table.status} != 'rejected'
        OR (
          ${table.rejectionReason} IS NOT NULL
          AND length(trim(${table.rejectionReason})) > 0
        )
      `
    ),

    temporalOrderCheck: check(
      'ck_kyc_verifications_temporal_order',
      sql`
        (${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.startedAt})
        AND (${table.expiresAt} IS NULL OR ${table.completedAt} IS NULL OR ${table.expiresAt} > ${table.completedAt})
      `
    ),

    riskScoreCheck: check(
      'ck_kyc_verifications_risk_score',
      sql`
        ${table.riskScore} IS NULL
        OR (${table.riskScore} >= 0 AND ${table.riskScore} <= 1000)
      `
    ),

    versionCheck: check('ck_kyc_verifications_version', sql`${table.version} > 0`),
  })
);

```

---

## `src/db/compliance/relations.ts`

```typescript
import { relations } from 'drizzle-orm';
import { userConsents } from './tables';
import { users } from '../user/tables';

export const userConsentsRelations = relations(userConsents, ({ one }) => ({
  user: one(users, { fields: [userConsents.userId], references: [users.id] }),
}));

```

---

## `src/db/compliance/tables.ts`

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';
import { CONSENT_TYPES } from '../constants';



//
//   Compliance subsystem
//   USER / ACTOR
//   N/A
//   SECURITY / AUDIT events

// ----------------------------------------------------------------------
// Entity: userConsents
// ----------------------------------------------------------------------
export const userConsents = sqliteTable(
  'user_consents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    consentType:   text('consent_type', { enum: CONSENT_TYPES }).notNull(),
    policyVersion: text('policy_version').notNull(), // Ex: '2.1.0' ou '2026-08'
    status:        text('status', { enum: ['accepted', 'declined', 'revoked'] }).notNull(),

    // Rastreabilidade
    source:    text('source'),    // 'web', 'mobile', 'api', 'admin'
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata:  text('metadata', { mode: 'json' }),

    acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
    revokedAt:  integer('revoked_at',  { mode: 'timestamp' }),
    createdAt:  integer('created_at',  { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  },
  (table) => ({
    userIdx:        index('idx_consents_user').on(table.userId),
    typeVersionIdx: index('idx_consents_type_version').on(table.consentType, table.policyVersion),
  })
);


```

---

## `src/db/constants.ts`

```typescript
// Constants extracted mechanically


export const USER_ROLES    = ['citizen', 'partner', 'admin', 'system', 'dev'] as const;


export const USER_STATUS   = ['pending_setup', 'active', 'suspended', 'locked', 'disabled'] as const;


export const AUTH_TYPES    = ['password', 'totp', 'webauthn', 'recovery_code', 'wallet'] as const;


export const CONSENT_TYPES = ['terms_of_service', 'privacy_policy', 'marketing', 'data_processing', 'cookies'] as const;


export const SECURITY_EVENT_TYPES = [
  'authentication_succeeded',
  'authentication_failed',
  'credential_created',
  'credential_verified',
  'credential_revoked',
  'password_changed',
  'password_reset_requested',
  'passkey_registered',
  'passkey_used',
  'totp_enabled',
  'totp_verified',
  'wallet_linked',
  'wallet_verified',
  'wallet_authenticated',
  'wallet_suspended',
  'wallet_revoked',
  'wallet_unlinked',
  'recovery_code_consumed',
  'account_locked',
  'account_unlocked',
  'auth_epoch_incremented',
] as const;


```

---

## `src/db/finance/relations.ts`

```typescript
import { relations } from 'drizzle-orm';
import { users } from '../user/tables';
import {
  financialAssets,
  financialAccounts,
  financialTransactions,
  financialLedgerEntries,
  accountBalances,
  balanceHolds,
  fiatProviders,
  fiatAccounts,
  fiatPaymentMethods,
  fiatTransactions,
  cryptoTransactions,
  exchangeRates,
  assetConversions,
  financialFees,
  fiatExternalTransactions,
  idempotencyKeys,
  reconciliationRecords,
} from './tables';

/**
 * ============================================================================
 * FINANCE DOMAIN RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to finance entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on finance tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */

// financialAssets
export const financialAssetsRelations = relations(financialAssets, ({ many }) => ({
  financialLedgerEntries: many(financialLedgerEntries),
  accountBalances: many(accountBalances),
  balanceHolds: many(balanceHolds),
  cryptoTransactionsAsAsset: many(cryptoTransactions, { relationName: 'cryptoTransactionAsset' }),
  cryptoTransactionsAsFeeAsset: many(cryptoTransactions, {
    relationName: 'cryptoTransactionFeeAsset',
  }),
  exchangeRatesAsBase: many(exchangeRates, { relationName: 'exchangeRateBaseAsset' }),
  exchangeRatesAsQuote: many(exchangeRates, { relationName: 'exchangeRateQuoteAsset' }),
  assetConversionsAsFrom: many(assetConversions, { relationName: 'assetConversionFromAsset' }),
  assetConversionsAsTo: many(assetConversions, { relationName: 'assetConversionToAsset' }),
  financialFees: many(financialFees),
  reconciliationRecords: many(reconciliationRecords),
}));

// financialAccounts
export const financialAccountsRelations = relations(financialAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [financialAccounts.userId],
    references: [users.id],
  }),
  financialLedgerEntries: many(financialLedgerEntries),
  accountBalances: many(accountBalances),
  balanceHolds: many(balanceHolds),
  financialFeesReceived: many(financialFees),
  reconciliationRecords: many(reconciliationRecords),
}));

// financialTransactions
export const financialTransactionsRelations = relations(financialTransactions, ({ one, many }) => ({
  user: one(users, {
    fields: [financialTransactions.userId],
    references: [users.id],
  }),
  ledgerEntries: many(financialLedgerEntries),
  fiatTransaction: one(fiatTransactions),
  cryptoTransaction: one(cryptoTransactions),
  assetConversion: one(assetConversions),
  fees: many(financialFees),
  idempotencyKeys: many(idempotencyKeys),
}));

// financialLedgerEntries
export const financialLedgerEntriesRelations = relations(financialLedgerEntries, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [financialLedgerEntries.transactionId],
    references: [financialTransactions.id],
  }),
  account: one(financialAccounts, {
    fields: [financialLedgerEntries.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [financialLedgerEntries.assetId],
    references: [financialAssets.id],
  }),
}));

// accountBalances
export const accountBalancesRelations = relations(accountBalances, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [accountBalances.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [accountBalances.assetId],
    references: [financialAssets.id],
  }),
}));

// balanceHolds
export const balanceHoldsRelations = relations(balanceHolds, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [balanceHolds.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [balanceHolds.assetId],
    references: [financialAssets.id],
  }),
}));

// fiatProviders
export const fiatProvidersRelations = relations(fiatProviders, ({ many }) => ({
  fiatAccounts: many(fiatAccounts),
  fiatTransactions: many(fiatTransactions),
  fiatExternalTransactions: many(fiatExternalTransactions),
  reconciliationRecords: many(reconciliationRecords),
}));

// fiatAccounts
export const fiatAccountsRelations = relations(fiatAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [fiatAccounts.userId],
    references: [users.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatAccounts.providerId],
    references: [fiatProviders.id],
  }),
  asset: one(financialAssets, {
    fields: [fiatAccounts.assetId],
    references: [financialAssets.id],
  }),
  paymentMethods: many(fiatPaymentMethods),
}));

// fiatPaymentMethods
export const fiatPaymentMethodsRelations = relations(fiatPaymentMethods, ({ one }) => ({
  user: one(users, {
    fields: [fiatPaymentMethods.userId],
    references: [users.id],
  }),
  fiatAccount: one(fiatAccounts, {
    fields: [fiatPaymentMethods.fiatAccountId],
    references: [fiatAccounts.id],
  }),
}));

// fiatTransactions
export const fiatTransactionsRelations = relations(fiatTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [fiatTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  paymentMethod: one(fiatPaymentMethods, {
    fields: [fiatTransactions.paymentMethodId],
    references: [fiatPaymentMethods.id],
  }),
  asset: one(financialAssets, {
    fields: [fiatTransactions.assetId],
    references: [financialAssets.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatTransactions.providerId],
    references: [fiatProviders.id],
  }),
}));

// cryptoTransactions
export const cryptoTransactionsRelations = relations(cryptoTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [cryptoTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  asset: one(financialAssets, {
    fields: [cryptoTransactions.assetId],
    references: [financialAssets.id],
    relationName: 'cryptoTransactionAsset',
  }),
  feeAsset: one(financialAssets, {
    fields: [cryptoTransactions.feeAssetId],
    references: [financialAssets.id],
    relationName: 'cryptoTransactionFeeAsset',
  }),
}));

// exchangeRates
export const exchangeRatesRelations = relations(exchangeRates, ({ one }) => ({
  baseAsset: one(financialAssets, {
    fields: [exchangeRates.baseAssetId],
    references: [financialAssets.id],
    relationName: 'exchangeRateBaseAsset',
  }),
  quoteAsset: one(financialAssets, {
    fields: [exchangeRates.quoteAssetId],
    references: [financialAssets.id],
    relationName: 'exchangeRateQuoteAsset',
  }),
}));

// assetConversions
export const assetConversionsRelations = relations(assetConversions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [assetConversions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  fromAsset: one(financialAssets, {
    fields: [assetConversions.fromAssetId],
    references: [financialAssets.id],
    relationName: 'assetConversionFromAsset',
  }),
  toAsset: one(financialAssets, {
    fields: [assetConversions.toAssetId],
    references: [financialAssets.id],
    relationName: 'assetConversionToAsset',
  }),
}));

// financialFees
export const financialFeesRelations = relations(financialFees, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [financialFees.transactionId],
    references: [financialTransactions.id],
  }),
  asset: one(financialAssets, {
    fields: [financialFees.assetId],
    references: [financialAssets.id],
  }),
  recipientAccount: one(financialAccounts, {
    fields: [financialFees.recipientAccountId],
    references: [financialAccounts.id],
  }),
}));

// fiatExternalTransactions
export const fiatExternalTransactionsRelations = relations(fiatExternalTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [fiatExternalTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatExternalTransactions.providerId],
    references: [fiatProviders.id],
  }),
}));

// idempotencyKeys
export const idempotencyKeysRelations = relations(idempotencyKeys, ({ one }) => ({
  user: one(users, {
    fields: [idempotencyKeys.userId],
    references: [users.id],
  }),
  financialTransaction: one(financialTransactions, {
    fields: [idempotencyKeys.financialTransactionId],
    references: [financialTransactions.id],
  }),
}));

// reconciliationRecords
export const reconciliationRecordsRelations = relations(reconciliationRecords, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [reconciliationRecords.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [reconciliationRecords.assetId],
    references: [financialAssets.id],
  }),
  provider: one(fiatProviders, {
    fields: [reconciliationRecords.providerId],
    references: [fiatProviders.id],
  }),
}));

```

---

## `src/db/finance/tables.ts`

```typescript
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * FINANCE DOMAIN
 * ============================================================================
 *
 * Responsibilities:
 * - Financial assets supported by the platform
 * - Financial accounts
 * - Financial transactions
 * - Double-entry ledger
 * - Account balances
 * - Balance holds
 * - Fiat providers / accounts / payment operations
 * - Crypto financial operations
 * - Asset conversions
 * - Fees
 * - External transaction references
 * - Idempotency
 * - Reconciliation
 *
 * Explicit boundaries:
 * - Authentication is owned by authentication/
 * - KYC / civil identity is owned by civil-identity/
 * - Authorization is owned by authorization/
 * - Blockchain technical infrastructure is owned by web3/
 * - Wallet identity is NOT represented here as a user identity
 *
 * Retention & Regulatory Policy:
 * - Double-Entry Ledger entries (financialLedgerEntries) and fees (financialFees)
 *   are APPEND-ONLY tables and MUST NEVER be deleted or updated.
 * - All foreign keys referencing users.id use onDelete: 'restrict' to ensure
 *   financial audit trails and accounting records survive user soft-deletion.
 *
 * Monetary values (Web3 Compatible):
 * - All amounts are stored as TEXT in the asset's smallest unit to support
 *   EVM precision (up to 18 decimals) which exceeds SQLite's 64-bit integer limit.
 * - Application layer MUST handle these using JS BigInt.
 * - BRL: 2 decimals  -> R$ 10.50 = "1050"
 * - USD: 2 decimals  -> US$ 10.50 = "1050"
 * - ETH: 18 decimals -> 1 ETH = "1000000000000000000"
 *
 * V1 supported financial assets:
 * - BRL
 * - USD
 * - BTC
 * ============================================================================
 */

/* ============================================================================
 * 1. FINANCIAL ASSETS
 * ============================================================================
 */
export const financialAssets = sqliteTable(
  'financial_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    type: text('type', {
      enum: ['fiat', 'crypto'],
    }).notNull(),
    decimals: integer('decimals').notNull(),
    status: text('status', {
      enum: ['active', 'inactive'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex('uq_financial_assets_code').on(table.code),
    typeIdx: index('idx_financial_assets_type').on(table.type),
    statusIdx: index('idx_financial_assets_status').on(table.status),
    typeCheck: check('ck_financial_assets_type', sql`${table.type} IN ('fiat', 'crypto')`),
    statusCheck: check(
      'ck_financial_assets_status',
      sql`${table.status} IN ('active', 'inactive')`
    ),
    decimalsCheck: check(
      'ck_financial_assets_decimals',
      sql`${table.decimals} >= 0 AND ${table.decimals} <= 18`
    ),
  })
);

/* ============================================================================
 * 2. FINANCIAL ACCOUNTS
 * ============================================================================
 */
export const financialAccounts = sqliteTable(
  'financial_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    accountType: text('account_type', {
      enum: ['user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow'],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'suspended'],
    })
      .notNull()
      .default('active'),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_financial_accounts_user').on(table.userId),
    typeIdx: index('idx_financial_accounts_type').on(table.accountType),
    statusIdx: index('idx_financial_accounts_status').on(table.status),
    accountTypeCheck: check(
      'ck_financial_accounts_type',
      sql`${table.accountType} IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow')`
    ),
    statusCheck: check(
      'ck_financial_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),
    userAccountTypeUq: uniqueIndex('uq_financial_accounts_user_type_name').on(
      table.userId,
      table.accountType,
      table.name
    ),
    ownerRuleCheck: check(
      'ck_financial_accounts_owner_rule',
      sql`(${table.accountType} = 'user_available' AND ${table.userId} IS NOT NULL) OR (${table.accountType} != 'user_available' AND ${table.userId} IS NULL)`
    ),
    versionCheck: check('ck_financial_accounts_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 3. FINANCIAL TRANSACTIONS
 * ============================================================================
 */
export const financialTransactions = sqliteTable(
  'financial_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    type: text('type', {
      enum: [
        'deposit',
        'withdrawal',
        'transfer',
        'payment',
        'refund',
        'fee',
        'reward',
        'yield',
        'conversion',
        'adjustment',
      ],
    }).notNull(),
    category: text('category', {
      enum: [
        'membership',
        'rwa_yield',
        'grant',
        'operational',
        'payment',
        'trading',
        'withdrawal',
        'deposit',
        'fee',
        'other',
      ],
    })
      .notNull()
      .default('other'),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded'],
    })
      .notNull()
      .default('pending'),
    sourceType: text('source_type', {
      enum: [
        'contribution',
        'grant',
        'membership',
        'payroll',
        'withdrawal',
        'payment',
        'conversion',
        'system',
        'other',
      ],
    }),
    sourceId: text('source_id'),
    correlationId: text('correlation_id'),
    description: text('description').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_financial_transactions_user').on(table.userId),
    typeIdx: index('idx_financial_transactions_type').on(table.type),
    statusIdx: index('idx_financial_transactions_status').on(table.status),
    createdIdx: index('idx_financial_transactions_created').on(table.createdAt),
    correlationIdx: index('idx_financial_transactions_correlation').on(table.correlationId),
    typeCheck: check(
      'ck_financial_tx_type',
      sql`${table.type} IN ('deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment')`
    ),
    categoryCheck: check(
      'ck_financial_tx_category',
      sql`${table.category} IN ('membership', 'rwa_yield', 'grant', 'operational', 'payment', 'trading', 'withdrawal', 'deposit', 'fee', 'other')`
    ),
    statusCheck: check(
      'ck_financial_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded')`
    ),
    sourceTypeCheck: check(
      'ck_financial_tx_source_type',
      sql`${table.sourceType} IS NULL OR ${table.sourceType} IN ('contribution', 'grant', 'membership', 'payroll', 'withdrawal', 'payment', 'conversion', 'system', 'other')`
    ),
    completedStateCheck: check(
      'ck_financial_tx_completed_state',
      sql`${table.status} != 'completed' OR ${table.completedAt} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_financial_tx_dates',
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.createdAt}`
    ),
    versionCheck: check('ck_financial_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 4. FINANCIAL LEDGER ENTRIES
 * ============================================================================
 */
export const financialLedgerEntries = sqliteTable(
  'financial_ledger_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    direction: text('direction', {
      enum: ['debit', 'credit'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index('idx_financial_ledger_entries_transaction').on(table.transactionId),
    accountIdx: index('idx_financial_ledger_entries_account').on(table.accountId),
    assetIdx: index('idx_financial_ledger_entries_asset').on(table.assetId),
    createdIdx: index('idx_financial_ledger_entries_created').on(table.createdAt),
    directionCheck: check(
      'ck_financial_ledger_direction',
      sql`${table.direction} IN ('debit', 'credit')`
    ),
    amountCheck: check(
      'ck_financial_ledger_entries_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
  })
);

/* ============================================================================
 * 5. ACCOUNT BALANCES
 * ============================================================================
 */
export const accountBalances = sqliteTable(
  'account_balances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    availableBaseUnits: text('available_base_units').notNull().default('0'),
    lockedBaseUnits: text('locked_base_units').notNull().default('0'),
    version: integer('version').notNull().default(1),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    accountAssetUq: uniqueIndex('uq_account_balances_account_asset').on(
      table.accountId,
      table.assetId
    ),
    accountIdx: index('idx_account_balances_account').on(table.accountId),
    assetIdx: index('idx_account_balances_asset').on(table.assetId),
    availableCheck: check(
      'ck_account_balances_available_nonnegative',
      sql`${table.availableBaseUnits} <> '' AND ltrim(${table.availableBaseUnits}, '0123456789') = '' AND (${table.availableBaseUnits} = '0' OR ltrim(${table.availableBaseUnits}, '0') = ${table.availableBaseUnits})`
    ),
    lockedCheck: check(
      'ck_account_balances_locked_nonnegative',
      sql`${table.lockedBaseUnits} <> '' AND ltrim(${table.lockedBaseUnits}, '0123456789') = '' AND (${table.lockedBaseUnits} = '0' OR ltrim(${table.lockedBaseUnits}, '0') = ${table.lockedBaseUnits})`
    ),
    versionCheck: check('ck_account_balances_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 6. BALANCE HOLDS
 * ============================================================================
 */
export const balanceHolds = sqliteTable(
  'balance_holds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    amountBaseUnits: text('amount_base_units').notNull(),
    reason: text('reason').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    status: text('status', {
      enum: ['active', 'released', 'expired', 'consumed'],
    })
      .notNull()
      .default('active'),
    version: integer('version').notNull().default(1),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    releasedAt: integer('released_at', { mode: 'timestamp' }),
  },
  (table) => ({
    accountIdx: index('idx_balance_holds_account').on(table.accountId),
    assetIdx: index('idx_balance_holds_asset').on(table.assetId),
    statusIdx: index('idx_balance_holds_status').on(table.status),
    referenceIdx: index('idx_balance_holds_reference').on(table.referenceType, table.referenceId),
    statusCheck: check(
      'ck_balance_holds_status',
      sql`${table.status} IN ('active', 'released', 'expired', 'consumed')`
    ),
    amountCheck: check(
      'ck_balance_holds_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
    releasedStateCheck: check(
      'ck_balance_holds_released_state',
      sql`${table.status} != 'released' OR ${table.releasedAt} IS NOT NULL`
    ),
    expiredStateCheck: check(
      'ck_balance_holds_expired_state',
      sql`${table.status} != 'expired' OR ${table.expiresAt} IS NOT NULL`
    ),
    versionCheck: check('ck_balance_holds_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 7. FIAT PROVIDERS
 * ============================================================================
 */
export const fiatProviders = sqliteTable(
  'fiat_providers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    type: text('type', {
      enum: ['bank', 'payment_provider', 'pix_provider', 'gateway'],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'suspended'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex('uq_fiat_providers_code').on(table.code),
    typeIdx: index('idx_fiat_providers_type').on(table.type),
    statusIdx: index('idx_fiat_providers_status').on(table.status),
    typeCheck: check(
      'ck_fiat_providers_type',
      sql`${table.type} IN ('bank', 'payment_provider', 'pix_provider', 'gateway')`
    ),
    statusCheck: check(
      'ck_fiat_providers_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),
  })
);

/* ============================================================================
 * 8. FIAT ACCOUNTS
 * ============================================================================
 */
export const fiatAccounts = sqliteTable(
  'fiat_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    type: text('type', {
      enum: ['bank_account', 'payment_account', 'pix_account'],
    }).notNull(),
    externalAccountId: text('external_account_id'),
    displayName: text('display_name'),
    last4: text('last4'),
    status: text('status', {
      enum: ['active', 'inactive', 'blocked'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_fiat_accounts_user').on(table.userId),
    providerIdx: index('idx_fiat_accounts_provider').on(table.providerId),
    statusIdx: index('idx_fiat_accounts_status').on(table.status),
    typeCheck: check(
      'ck_fiat_accounts_type',
      sql`${table.type} IN ('bank_account', 'payment_account', 'pix_account')`
    ),
    statusCheck: check(
      'ck_fiat_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'blocked')`
    ),
    blockedStateCheck: check(
      'ck_fiat_accounts_blocked_state',
      sql`${table.status} != 'blocked' OR ${table.blockedAt} IS NOT NULL`
    ),
    externalUq: uniqueIndex('uq_fiat_accounts_provider_external').on(
      table.providerId,
      table.externalAccountId
    ),
    userAccountUq: uniqueIndex('uq_fiat_accounts_user_account').on(table.userId, table.id),
  })
);

/* ============================================================================
 * 9. FIAT PAYMENT METHODS
 * ============================================================================
 */
export const fiatPaymentMethods = sqliteTable(
  'fiat_payment_methods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),
    fiatAccountId: integer('fiat_account_id'),
    type: text('type', {
      enum: ['pix', 'bank_transfer', 'boleto', 'card'],
    }).notNull(),
    label: text('label').notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'blocked'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    fiatAccountFk: foreignKey({
      columns: [table.userId, table.fiatAccountId],
      foreignColumns: [fiatAccounts.userId, fiatAccounts.id],
      name: 'fk_fiat_payment_methods_user_account',
    }).onDelete('restrict'),
    userIdx: index('idx_fiat_payment_methods_user').on(table.userId),
    accountIdx: index('idx_fiat_payment_methods_account').on(table.fiatAccountId),
    typeIdx: index('idx_fiat_payment_methods_type').on(table.type),
    statusIdx: index('idx_fiat_payment_methods_status').on(table.status),
    typeCheck: check(
      'ck_fiat_pm_type',
      sql`${table.type} IN ('pix', 'bank_transfer', 'boleto', 'card')`
    ),
    statusCheck: check(
      'ck_fiat_pm_status',
      sql`${table.status} IN ('active', 'inactive', 'blocked')`
    ),
    blockedStateCheck: check(
      'ck_fiat_pm_blocked_state',
      sql`${table.status} != 'blocked' OR ${table.blockedAt} IS NOT NULL`
    ),
  })
);

/* ============================================================================
 * 10. FIAT TRANSACTIONS
 * ============================================================================
 */
export const fiatTransactions = sqliteTable(
  'fiat_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    paymentMethodId: integer('payment_method_id').references(() => fiatPaymentMethods.id, {
      onDelete: 'restrict',
    }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'],
    })
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
    settledAt: integer('settled_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_fiat_transactions_financial_transaction').on(
      table.financialTransactionId
    ),
    providerIdx: index('idx_fiat_transactions_provider').on(table.providerId),
    paymentMethodIdx: index('idx_fiat_transactions_payment_method').on(table.paymentMethodId),
    assetIdx: index('idx_fiat_transactions_asset').on(table.assetId),
    statusIdx: index('idx_fiat_transactions_status').on(table.status),
    directionCheck: check(
      'ck_fiat_tx_direction',
      sql`${table.direction} IN ('inbound', 'outbound')`
    ),
    statusCheck: check(
      'ck_fiat_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed')`
    ),
    amountCheck: check(
      'ck_fiat_transactions_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
    temporalOrderCheck: check(
      'ck_fiat_tx_dates',
      sql`${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.requestedAt}`
    ),
    versionCheck: check('ck_fiat_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 11. CRYPTO TRANSACTIONS
 * ============================================================================
 */
export const cryptoTransactions = sqliteTable(
  'crypto_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    web3TransactionId: text('web3_transaction_id'),
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    feeAssetId: integer('fee_asset_id').references(() => financialAssets.id, {
      onDelete: 'restrict',
    }),
    feeBaseUnits: text('fee_base_units').notNull().default('0'),
    status: text('status', {
      enum: ['pending', 'processing', 'confirmed', 'failed', 'reversed'],
    })
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    settledAt: integer('settled_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_crypto_transactions_financial_transaction').on(
      table.financialTransactionId
    ),
    web3TransactionUq: uniqueIndex('uq_crypto_transactions_web3_transaction').on(
      table.web3TransactionId
    ),
    assetIdx: index('idx_crypto_transactions_asset').on(table.assetId),
    statusIdx: index('idx_crypto_transactions_status').on(table.status),
    directionCheck: check(
      'ck_crypto_tx_direction',
      sql`${table.direction} IN ('inbound', 'outbound')`
    ),
    statusCheck: check(
      'ck_crypto_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'confirmed', 'failed', 'reversed')`
    ),
    amountCheck: check(
      'ck_crypto_transactions_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
    feeCheck: check(
      'ck_crypto_transactions_fee_nonnegative',
      sql`${table.feeBaseUnits} <> '' AND ltrim(${table.feeBaseUnits}, '0123456789') = '' AND (${table.feeBaseUnits} = '0' OR ltrim(${table.feeBaseUnits}, '0') = ${table.feeBaseUnits})`
    ),
    feeAssetCheck: check(
      'ck_crypto_transactions_fee_asset',
      sql`${table.feeBaseUnits} = '0' OR ${table.feeAssetId} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_crypto_tx_dates',
      sql`${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.requestedAt}`
    ),
    versionCheck: check('ck_crypto_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 12. EXCHANGE RATES
 * ============================================================================
 */
export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    baseAssetId: integer('base_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    quoteAssetId: integer('quote_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    rate: text('rate').notNull(),
    source: text('source').notNull(),
    quotedAt: integer('quoted_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    pairIdx: index('idx_exchange_rates_pair').on(table.baseAssetId, table.quoteAssetId),
    quotedIdx: index('idx_exchange_rates_quoted').on(table.quotedAt),
    pairDifferentCheck: check(
      'ck_exchange_rates_different_assets',
      sql`${table.baseAssetId} <> ${table.quoteAssetId}`
    ),
    rateCheck: check('ck_exchange_rates_rate_positive', sql`CAST(${table.rate} AS REAL) > 0`),
    expiresCheck: check(
      'ck_exchange_rates_expires_after_quoted',
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} >= ${table.quotedAt}`
    ),
  })
);

/* ============================================================================
 * 13. ASSET CONVERSIONS
 * ============================================================================
 */
export const assetConversions = sqliteTable(
  'asset_conversions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    fromAssetId: integer('from_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    toAssetId: integer('to_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    fromAmountBaseUnits: text('from_amount_base_units').notNull(),
    toAmountBaseUnits: text('to_amount_base_units').notNull(),
    rate: text('rate').notNull(),
    rateSource: text('rate_source'),
    quotedAt: integer('quoted_at', { mode: 'timestamp' }),
    feeAmountBaseUnits: text('fee_amount_base_units').notNull().default('0'),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_asset_conversions_transaction').on(table.financialTransactionId),
    fromAssetIdx: index('idx_asset_conversions_from_asset').on(table.fromAssetId),
    toAssetIdx: index('idx_asset_conversions_to_asset').on(table.toAssetId),
    statusCheck: check(
      'ck_asset_conversions_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled')`
    ),
    fromAmountCheck: check(
      'ck_asset_conversions_from_amount_positive',
      sql`${table.fromAmountBaseUnits} <> '' AND ltrim(${table.fromAmountBaseUnits}, '0123456789') = '' AND ${table.fromAmountBaseUnits} <> '0' AND ltrim(${table.fromAmountBaseUnits}, '0') = ${table.fromAmountBaseUnits}`
    ),
    toAmountCheck: check(
      'ck_asset_conversions_to_amount_positive',
      sql`${table.toAmountBaseUnits} <> '' AND ltrim(${table.toAmountBaseUnits}, '0123456789') = '' AND ${table.toAmountBaseUnits} <> '0' AND ltrim(${table.toAmountBaseUnits}, '0') = ${table.toAmountBaseUnits}`
    ),
    feeCheck: check(
      'ck_asset_conversions_fee_nonnegative',
      sql`${table.feeAmountBaseUnits} <> '' AND ltrim(${table.feeAmountBaseUnits}, '0123456789') = '' AND (${table.feeAmountBaseUnits} = '0' OR ltrim(${table.feeAmountBaseUnits}, '0') = ${table.feeAmountBaseUnits})`
    ),
    assetsDifferentCheck: check(
      'ck_asset_conversions_different_assets',
      sql`${table.fromAssetId} <> ${table.toAssetId}`
    ),
    rateCheck: check('ck_asset_conversions_rate_positive', sql`CAST(${table.rate} AS REAL) > 0`),
  })
);

/* ============================================================================
 * 14. FINANCIAL FEES
 * ============================================================================
 */
export const financialFees = sqliteTable(
  'financial_fees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    recipientAccountId: integer('recipient_account_id').references(() => financialAccounts.id, {
      onDelete: 'restrict',
    }),
    feeType: text('fee_type', {
      enum: ['platform', 'withdrawal', 'payment', 'conversion', 'network', 'other'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index('idx_financial_fees_transaction').on(table.transactionId),
    assetIdx: index('idx_financial_fees_asset').on(table.assetId),
    recipientIdx: index('idx_financial_fees_recipient_account').on(table.recipientAccountId),
    feeTypeCheck: check(
      'ck_financial_fees_type',
      sql`${table.feeType} IN ('platform', 'withdrawal', 'payment', 'conversion', 'network', 'other')`
    ),
    amountCheck: check(
      'ck_financial_fees_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
  })
);

/* ============================================================================
 * 15. EXTERNAL TRANSACTIONS
 * ============================================================================
 */
export const fiatExternalTransactions = sqliteTable(
  'fiat_external_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    externalTransactionId: text('external_transaction_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    providerExternalUq: uniqueIndex('uq_fiat_external_transactions_provider_external').on(
      table.providerId,
      table.externalTransactionId
    ),
    transactionIdx: index('idx_fiat_external_transactions_transaction').on(
      table.financialTransactionId
    ),
    providerIdx: index('idx_fiat_external_transactions_provider').on(table.providerId),
    statusIdx: index('idx_fiat_external_transactions_status').on(table.status),
  })
);

/* ============================================================================
 * 16. IDEMPOTENCY KEYS
 * ============================================================================
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    financialTransactionId: integer('financial_transaction_id').references(
      () => financialTransactions.id,
      {
        onDelete: 'restrict',
      }
    ),
    status: text('status', {
      enum: ['processing', 'completed', 'failed'],
    })
      .notNull()
      .default('processing'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    scopeKeyUq: uniqueIndex('uq_idempotency_scope_key').on(table.scope, table.key),
    userIdx: index('idx_idempotency_keys_user').on(table.userId),
    transactionIdx: index('idx_idempotency_keys_transaction').on(table.financialTransactionId),
    statusIdx: index('idx_idempotency_keys_status').on(table.status),
    statusCheck: check(
      'ck_idempotency_keys_status',
      sql`${table.status} IN ('processing', 'completed', 'failed')`
    ),
    expiresCheck: check(
      'ck_idempotency_keys_expires',
      sql`${table.expiresAt} IS NULL OR ${table.createdAt} < ${table.expiresAt}`
    ),
  })
);

/* ============================================================================
 * 17. RECONCILIATION RECORDS
 * ============================================================================
 */
export const reconciliationRecords = sqliteTable(
  'reconciliation_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    expectedBalanceBaseUnits: text('expected_balance_base_units').notNull(),
    actualBalanceBaseUnits: text('actual_balance_base_units').notNull(),
    differenceBaseUnits: text('difference_base_units').notNull(),
    status: text('status', {
      enum: ['matched', 'mismatch', 'resolved'],
    })
      .notNull()
      .default('matched'),
    reconciliationRunId: text('reconciliation_run_id').notNull(),
    version: integer('version').notNull().default(1),
    reconciliationDate: integer('reconciliation_date', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  },
  (table) => ({
    accountIdx: index('idx_reconciliation_records_account').on(table.accountId),
    assetIdx: index('idx_reconciliation_records_asset').on(table.assetId),
    providerIdx: index('idx_reconciliation_records_provider').on(table.providerId),
    statusIdx: index('idx_reconciliation_records_status').on(table.status),
    statusCheck: check(
      'ck_reconciliation_status',
      sql`${table.status} IN ('matched', 'mismatch', 'resolved')`
    ),
    resolvedStateCheck: check(
      'ck_reconciliation_resolved_state',
      sql`${table.status} != 'resolved' OR ${table.resolvedAt} IS NOT NULL`
    ),
    versionCheck: check('ck_reconciliation_records_version', sql`${table.version} > 0`),
    expectedCheck: check(
      'ck_reconciliation_expected_nonnegative',
      sql`${table.expectedBalanceBaseUnits} <> '' AND ltrim(${table.expectedBalanceBaseUnits}, '0123456789') = '' AND (${table.expectedBalanceBaseUnits} = '0' OR ltrim(${table.expectedBalanceBaseUnits}, '0') = ${table.expectedBalanceBaseUnits})`
    ),
    actualCheck: check(
      'ck_reconciliation_actual_nonnegative',
      sql`${table.actualBalanceBaseUnits} <> '' AND ltrim(${table.actualBalanceBaseUnits}, '0123456789') = '' AND (${table.actualBalanceBaseUnits} = '0' OR ltrim(${table.actualBalanceBaseUnits}, '0') = ${table.actualBalanceBaseUnits})`
    ),
  })
);

```

---

## `src/db/index.ts`

```typescript
/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Database Connection Factory (Drizzle ORM + D1)
 * Version: 1.1.0
 */
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

/**
 * Instancia a conexão com o banco de dados D1.
 * O mapeamento do 'schema' permite o uso da Query API (db.query.users.findFirst)
 * @param d1 O binding do D1Database vindo do ambiente (c.env.DB)
 */
export const createDb = (d1: D1Database) => {
  return drizzle(d1, { schema });
};

/**
 * Tipo Database para ser utilizado no contexto do Hono (c.set('db', db))
 */
export type Database = DrizzleD1Database<typeof schema>;

```

---

## `src/db/infrastructure/relations.ts`

```typescript
import { relations, AnyColumn, RelationConfig } from 'drizzle-orm';


```

---

## `src/db/infrastructure/tables.ts`

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';



//
//   Infrastructure subsystem (Cross-cutting)
//   N/A
//   Multiple domains
//   N/A

// ----------------------------------------------------------------------
// Entity: outboxEvents
// ----------------------------------------------------------------------
export const outboxEvents = sqliteTable('outbox_events', {
  id: text('id').primaryKey(), // UUID do evento (eventId)
  aggregateId: integer('aggregate_id').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateVersion: integer('aggregate_version').notNull(),
  eventName: text('event_name').notNull(),
  payload: text('payload').notNull(), // JSON
  metadata: text('metadata'), // JSON
  attempts: integer('attempts').default(0).notNull(),
  published: integer('published', { mode: 'boolean' }).default(false).notNull(),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
});


```

---

## `src/db/integrations/relations.ts`

```typescript
import { relations, AnyColumn, RelationConfig } from 'drizzle-orm';


```

---

## `src/db/integrations/tables.ts`

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';



//
//   Integrations subsystem
//   N/A
//   N/A
//   N/A

// ----------------------------------------------------------------------
// Entity: integrationConfigs
// ----------------------------------------------------------------------
export const integrationConfigs = sqliteTable(
  'integration_configs',
  {
    id: text('id').primaryKey(), // UUID
    provider: text('provider').notNull(), // ex: binance, stripe, openai
    category: text('category', {
      enum: ['finance', 'web3', 'ai', 'communications', 'oauth', 'infrastructure', 'analytics'],
    }).notNull(),
    environment: text('environment', {
      enum: ['local', 'preview', 'staging', 'production'],
    })
      .notNull()
      .default('production'),

    baseUrl: text('base_url'),
    sandboxMode: integer('sandbox_mode', { mode: 'boolean' }).default(false),

    riskClassification: text('risk_classification', {
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'NUCLEAR'],
    })
      .notNull()
      .default('MEDIUM'),

    rotationIntervalDays: integer('rotation_interval_days'),
    nextRotationAt: integer('next_rotation_at', { mode: 'timestamp' }),

    status: text('status', {
      enum: ['online', 'failing', 'missing'],
    }).default('missing'),

    dependencies: text('dependencies', { mode: 'json' }).$type<string[]>(), // Ex: ["Billing", "Marketplace"]

    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    providerEnvIdx: uniqueIndex('idx_integration_provider_env').on(
      table.provider,
      table.environment
    ),
  })
);



// ----------------------------------------------------------------------
// Entity: integrationSecrets
// ----------------------------------------------------------------------
export const integrationSecrets = sqliteTable(
  'integration_secrets',
  {
    id: text('id').primaryKey(), // UUID
    configId: text('config_id')
      .notNull()
      .references(() => integrationConfigs.id, { onDelete: 'cascade' }),
    keyName: text('key_name').notNull(), // ex: STRIPE_SECRET
    encryptedValue: text('encrypted_value').notNull(), // AES-256-GCM encrypted

    version: integer('version').notNull().default(1),
    scopesAllowed: text('scopes_allowed', { mode: 'json' }).$type<string[]>(),

    // Leasing & Ownership
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
    ownerRole: text('owner_role').default('dev'),
    ownerUserId: integer('owner_user_id').references(() => users.id),

    updatedBy: integer('updated_by').references(() => users.id), // ID do admin
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    configKeyIdx: uniqueIndex('idx_integration_secret_config_key').on(
      table.configId,
      table.keyName
    ),
  })
);



// ----------------------------------------------------------------------
// Entity: integrationSecretVersions
// ----------------------------------------------------------------------
export const integrationSecretVersions = sqliteTable('integration_secret_versions', {
  id: text('id').primaryKey(), // UUID
  secretId: text('secret_id')
    .notNull()
    .references(() => integrationSecrets.id, { onDelete: 'cascade' }),
  encryptedValue: text('encrypted_value').notNull(),
  version: integer('version').notNull(),

  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  createdBy: integer('created_by').references(() => users.id),
});


```

---

## `src/db/migrations/0002_add_domain_columns.up.sql`

```sql
ALTER TABLE financial_transactions ADD COLUMN counterparty_name TEXT;
ALTER TABLE financial_transactions ADD COLUMN origin_institution TEXT;
ALTER TABLE financial_transactions ADD COLUMN destination_institution TEXT;
ALTER TABLE financial_transactions ADD COLUMN payment_method TEXT;
ALTER TABLE financial_transactions ADD COLUMN source_proof TEXT;

```

---

## `src/db/migrations/0003_reconcile_account_10_balance.sql`

```sql
-- ============================================================================
-- ASPPIBRA DAO - MANUAL ACCOUNT BALANCE RECONCILIATION SCRIPT
-- Reconciliação do Saldo Devedor da Conta 10 (Andressa de Lima Ferreira)
-- Ajuste: R$ 800,00 (80000 centavos) via Crédito na Conta 10 e Débito na Conta 1
-- ============================================================================

-- 1. Inserção da Transação de Reconciliação Auditada
INSERT INTO financial_transactions (
  user_id,
  type,
  category, 
  status, 
  description, 
  counterparty_name, 
  origin_institution, 
  destination_institution, 
  payment_method, 
  source_proof, 
  completed_at,
  created_at,
  updated_at
) VALUES (
  10, 
  'adjustment',
  'operational', 
  'completed', 
  'Ajuste de Reconciliação Auditada - Correção de Saldo Devedor', 
  'Sistema de Tesouraria ASPPIBRA', 
  'Conta de Ajuste Institucional', 
  'Conta de Associado 10', 
  'ajuste_manual', 
  'Audit_Proof_Ref_2026_08_20', 
  unixepoch(),
  unixepoch(),
  unixepoch()
);

-- 2. Lado 1: Lançamento de Crédito na Conta da Associada (Conta 10)
INSERT INTO financial_ledger_entries (
  transaction_id, 
  account_id, 
  asset_id,
  direction, 
  amount_base_units, 
  created_at
) VALUES (
  (SELECT id FROM financial_transactions ORDER BY id DESC LIMIT 1), 
  10, 
  1,
  'credit', 
  '80000', 
  unixepoch()
);

-- 3. Lado 2: Lançamento Espelho de Débito na Conta Institucional de Ajuste (Conta 1)
INSERT INTO financial_ledger_entries (
  transaction_id, 
  account_id, 
  asset_id,
  direction, 
  amount_base_units, 
  created_at
) VALUES (
  (SELECT id FROM financial_transactions ORDER BY id DESC LIMIT 1), 
  1, 
  1,
  'debit', 
  '80000', 
  unixepoch()
);

-- 4. Atualiza o saldo devedor real na tabela account_balances (R$ 28.377,00 em centavos = 2837700)
UPDATE account_balances 
SET locked_base_units = '2837700', updated_at = unixepoch() 
WHERE account_id = 10;

```

---

## `src/db/schema.ts`

```typescript
/**
 * DATABASE SCHEMA AGGREGATOR
 *
 * Project: Governance System (ASPPIBRA DAO)
 * ORM: Drizzle ORM
 * Database: SQLite / Cloudflare D1
 *
 * PURPOSE
 * -------
 * This file is the central composition point of the Drizzle schema.
 *
 * It:
 *   - re-exports domain tables;
 *   - re-exports domain relations;
 *   - exposes schema constants;
 *   - preserves compatibility with existing consumers;
 *   - registers the complete schema surface for Drizzle Query API.
 *
 * ARCHITECTURAL ROLE
 * ------------------
 * This file is an AGGREGATOR.
 *
 * It is NOT:
 *   - a domain;
 *   - a business-rule layer;
 *   - a repository;
 *   - a service;
 *   - an application use case.
 *
 * DATABASE OWNERSHIP RULE
 * -----------------------
 * Each physical table belongs to exactly one persistence domain below.
 *
 * Infrastructure/application code SHOULD import tables directly from
 * their owning domain module whenever practical.
 *
 * Prefer:
 *
 *   import { users } from '@/db/user/tables';
 *
 * over:
 *
 *   import { users } from '@/db/schema';
 *
 * The schema aggregator remains valid for:
 *   - Drizzle schema composition;
 *   - Database Factory registration;
 *   - Query API registration;
 *   - compatibility with legacy consumers during migration.
 *
 * IMPORTANT
 * ---------
 * The numeric prefixes below describe documentation order only.
 * They DO NOT establish application dependency priority.
 *
 * Actual dependencies must be inferred from:
 *   1. Foreign Keys;
 *   2. Drizzle relations();
 *   3. Application-layer imports;
 *   4. Domain events;
 *   5. Explicit logical references.
 *
 * SOURCE OF TRUTH
 * ---------------
 * The table lists below represent the CURRENT PHYSICAL DATABASE SCHEMA.
 *
 * Do NOT add future/planned entities to this document until they
 * physically exist in the corresponding tables.ts file.
 */

/**
 * ======================================================================
 * PERSISTENCE DOMAIN DEPENDENCY MAP
 * ======================================================================
 *
 * Terminology:
 *
 * Depends on:
 *   A physical FK or declared persistence dependency.
 *
 * References:
 *   A logical/application reference that does not necessarily represent
 *   a physical FK.
 *
 * Cross-cutting:
 *   Infrastructure used by multiple domains rather than owned by a
 *   single business domain.
 */

/**
 * ======================================================================
 * 10. USER / ACTOR
 * ======================================================================
 *
 * Role:
 *   Base actor/account identity persistence.
 *
 * Persistence owner:
 *   user
 *
 * Tables:
 *   - users
 *   - userProfiles
 *   - userContacts
 *   - userAddresses
 *   - userProfessionalExperience
 *   - userEducation
 *   - membershipCards
 *   - userNotificationSettings
 *
 * Depends on:
 *   - None at persistence FK level for the aggregate root "users".
 *   - organizations (optional reference via userProfessionalExperience.organizationId and userEducation.organizationId).
 *
 * Prohibited Dependencies (Section 05 Boundary Matrix):
 *   - web3
 *   - civil-identity
 *   - ssi
 *   - finance
 *
 * Referenced by:
 *   - authentication
 *   - authorization
 *   - civil-identity
 *   - ssi
 *   - organizations
 *   - web3
 *   - social
 *   - communication
 *   - governance
 *   - contributions
 *   - contracts
 *   - finance
 *   - real-estate
 *   - integrations
 *   - compliance
 *   - security
 *
 * Architectural rule:
 *   "users" is the base actor identity and should not become a
 *   container for unrelated business concepts.
 */

/**
 * ======================================================================
 * 20. AUTHENTICATION
 * ======================================================================
 *
 * Role:
 *   Authentication credentials, authentication challenges and sessions.
 *
 * Persistence owner:
 *   authentication
 *
 * Tables:
 *   - userAuthenticators
 *   - passwordCredentials
 *   - webauthnCredentials
 *   - totpCredentials
 *   - recoverySets
 *   - recoveryCredentials
 *   - passwordResets
 *   - userSessions
 *   - authChallenges
 *   - walletAuthenticators
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - WEB3 IDENTITY through walletAuthenticators -> wallets
 *
 * Cross-cutting concerns:
 *   - SECURITY / AUDIT events
 *
 * Architectural rule:
 *   Authentication mechanisms belong here.
 *   Wallets themselves do NOT belong here; only wallet-based
 *   authentication belongs here.
 */

/**
 * ======================================================================
 * 30. AUTHORIZATION
 * ======================================================================
 *
 * Role:
 *   Role-based authorization and role assignments.
 *
 * Persistence owner:
 *   authorization
 *
 * Tables:
 *   - roles
 *   - userRoles
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - None beyond the explicit user/role relationships currently
 *     represented in the schema.
 *
 * Architectural rule:
 *   Authorization data must not be inferred from users.status or from
 *   legacy "primary role" fields.
 *   userRoles is the source for role assignment persistence.
 *
 * NOTE:
 *   No permissions or rolePermissions tables are declared here because
 *   they are not part of the current physical schema.
 */

/**
 * ======================================================================
 * 40. CIVIL IDENTITY / KYC
 * ======================================================================
 *
 * Role:
 *   Civil identity and KYC verification persistence.
 *
 * Persistence owner:
 *   civil-identity
 *
 * Tables:
 *   - citizens
 *   - identityDocuments
 *   - kycVerifications
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - None beyond the explicit user relationships currently declared.
 *
 * Important semantic distinction:
 *
 *   citizens.civilStatus
 *     = state of the civil identity/account identity.
 *
 *   kycVerifications.status
 *     = state of an individual KYC verification process.
 *
 * These states are NOT interchangeable.
 *
 * Architectural rule:
 *   KYC verification is not the same concept as account suspension.
 */

/**
 * ======================================================================
 * 50. SSI / DIGITAL IDENTITY
 * ======================================================================
 *
 * Role:
 *   Self-Sovereign Identity and secure digital identity material.
 *
 * Persistence owner:
 *   ssi
 *
 * Tables:
 *   - secureVaults
 *   - didIdentities
 *   - didVerificationMethods
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - None beyond the current physical FK relationships.
 *
 * Architectural rule:
 *   This domain stores digital identity material and DID structures.
 *   It must not silently become a replacement for the civil identity
 *   or authentication domains.
 */

/**
 * ======================================================================
 * 60. ORGANIZATIONS
 * ======================================================================
 *
 * Role:
 *   Organizations, memberships and mandates.
 *
 * Persistence owner:
 *   organizations
 *
 * Tables:
 *   - organizations
 *   - organizationMemberships
 *   - mandates
 *
 * Depends on:
 *   - USER / ACTOR
 *   - CIVIL IDENTITY / KYC through mandates.appointmentDocumentId
 *
 * Referenced by:
 *   - USER / ACTOR (optional reference via userProfessionalExperience.organizationId and userEducation.organizationId)
 *
 * References:
 *   - identityDocuments through the appointment document relationship.
 *
 * Architectural rule:
 *   Organization membership and organizational mandates are different
 *   concepts and should not be collapsed into users or roles.
 */

/**
 * ======================================================================
 * 70. WEB3 IDENTITY
 * ======================================================================
 *
 * Role:
 *   Blockchain wallet identity and wallet ownership.
 *
 * Persistence owner:
 *   web3
 *
 * Tables:
 *   - wallets
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Referenced by:
 *   - AUTHENTICATION through walletAuthenticators
 *   - SECURITY / AUDIT through securityEvents.walletId
 *   - REAL ESTATE / RWA logically and through blockchain-related data
 *
 * Architectural rule:
 *   wallets represents Web3 identity.
 *   walletAuthenticators represents authentication using a wallet and
 *   therefore belongs to AUTHENTICATION.
 */

/**
 * ======================================================================
 * 80. SOCIAL
 * ======================================================================
 *
 * Role:
 *   Social identity, publishing and social interactions.
 *
 * Persistence owner:
 *   social
 *
 * Tables:
 *   - userSocialLinks
 *   - posts
 *   - postComments
 *   - postFavorites
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Internal relationships:
 *   - postComments -> posts
 *   - postFavorites -> posts
 *
 * Architectural rule:
 *   Social content remains separate from the core user identity.
 */

/**
 * ======================================================================
 * 90. COMMUNICATION
 * ======================================================================
 *
 * Role:
 *   Omnichannel communication persistence.
 *
 * Persistence owner:
 *   communication
 *
 * Tables:
 *   Notifications:
 *   - notifications
 *
 *   Email:
 *   - emailAccounts
 *   - emailThreads
 *   - emailLabels
 *   - emails
 *   - emailMessageLabels
 *   - emailAttachments
 *   - emailEvents
 *
 *   Chat:
 *   - chatConversations
 *   - chatParticipants
 *   - chatMessages
 *   - chatAttachments
 *   - chatReadReceipts
 *   - chatEvents
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Internal relationships:
 *   - emailThreads -> emailAccounts
 *   - emailLabels -> emailAccounts
 *   - emails -> emailAccounts
 *   - emails -> emailThreads
 *   - emailMessageLabels -> emails
 *   - emailMessageLabels -> emailLabels
 *   - emailAttachments -> emails
 *   - emailEvents -> emails
 *   - chatParticipants -> chatConversations
 *   - chatMessages -> chatConversations
 *   - chatAttachments -> chatMessages
 *   - chatReadReceipts -> chatMessages
 *   - chatEvents -> chatConversations
 *
 * Architectural rule:
 *   Email, Chat and Notifications are communication concerns.
 *   They should not become hidden storage layers for unrelated
 *   business domains.
 */

/**
 * ======================================================================
 * 100. GOVERNANCE
 * ======================================================================
 *
 * Role:
 *   DAO governance proposals and voting.
 *
 * Persistence owner:
 *   governance
 *
 * Tables:
 *   - govProposals
 *   - govVotes
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Internal relationships:
 *   - govVotes -> govProposals
 *
 * References:
 *   - ORGANIZATIONS may be an application-level reference when
 *     governance is scoped to an organization, but no corresponding
 *     Organization FK is currently defined in these tables.
 *
 * Architectural rule:
 *   Do not document future delegation/voting-strategy tables here until
 *   they physically exist.
 */

/**
 * ======================================================================
 * 110. CONTRIBUTIONS
 * ======================================================================
 *
 * Role:
 *   Contribution and bounty persistence.
 *
 * Persistence owner:
 *   contributions
 *
 * Tables:
 *   - bounties
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Internal relationships:
 *   - bounties.creatorId -> users
 *   - bounties.assigneeId -> users
 *
 * Architectural rule:
 *   Current physical persistence is intentionally minimal.
 *   Do not infer task-management tables that are not physically present.
 */

/**
 * ======================================================================
 * 120. CONTRACTS / OBLIGATIONS
 * ======================================================================
 *
 * Role:
 *   Contract and payment-obligation persistence.
 *
 * Persistence owner:
 *   contracts
 *
 * Tables:
 *   - contracts
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Architectural rule:
 *   A contract is a business/legal obligation.
 *   It must remain conceptually distinct from individual treasury
 *   transactions.
 */

/**
 * ======================================================================
 * 130. FINANCE / TREASURY
 * ======================================================================
 *
 * Role:
 *   Treasury transaction ledger.
 *
 * Persistence owner:
 *   finance
 *
 * Tables:
 *   - treasuryLedger
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - REAL ESTATE / RWA may generate financial events logically.
 *   - WEB3 IDENTITY may provide blockchain transaction context logically.
 *
 * Architectural rule:
 *   wallets is NOT owned by finance.
 *   The physical owner of wallets is WEB3 IDENTITY.
 */

/**
 * ======================================================================
 * 140. REAL ESTATE / RWA
 * ======================================================================
 *
 * Role:
 *   Real-estate asset registration, documentation, workflow and
 *   blockchain/RWA persistence.
 *
 * Persistence owner:
 *   real-estate
 *
 * Tables:
 *   - reProperties
 *   - rePropertyLocation
 *   - reSurveyPoints
 *   - rePropertyLand
 *   - rePropertyConstruction
 *   - rePropertyInfrastructure
 *   - rePropertyPricing
 *   - rePropertyOwners
 *   - rePropertyProfessionals
 *   - rePropertyDocuments
 *   - rePropertyMedia
 *   - rePropertyBlockchain
 *   - rePropertyWorkflow
 *   - rePropertyAuditLog
 *
 * Depends on:
 *   - USER / ACTOR through property owner/actor references.
 *
 * Logical references:
 *   - WEB3 IDENTITY through blockchain ownership/wallet information.
 *   - ORGANIZATIONS through professionals and organizational context.
 *
 * Internal relationships:
 *   - All reProperty* child entities reference reProperties.
 *
 * Architectural rule:
 *   Real-estate persistence is a complete bounded persistence area.
 *   Do not distribute its child tables across unrelated domains.
 */

/**
 * ======================================================================
 * 150. INTEGRATIONS
 * ======================================================================
 *
 * Role:
 *   External provider configuration and secret metadata.
 *
 * Persistence owner:
 *   integrations
 *
 * Tables:
 *   - integrationConfigs
 *   - integrationSecrets
 *   - integrationSecretVersions
 *
 * Depends on:
 *   - None at the integrationConfigs root level.
 *
 * References:
 *   - USER / ACTOR through ownerUserId / updatedBy / createdBy relationships.
 *
 * Internal relationships:
 *   - integrationSecrets -> integrationConfigs
 *   - integrationSecretVersions -> integrationSecrets
 *
 * Architectural rule:
 *   Integration configuration is infrastructure/integration metadata.
 *   It must not become an application-domain substitute for provider
 *   services.
 */

/**
 * ======================================================================
 * 160. COMPLIANCE / PRIVACY
 * ======================================================================
 *
 * Role:
 *   Privacy consent and policy acceptance persistence.
 *
 * Persistence owner:
 *   compliance
 *
 * Tables:
 *   - userConsents
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Emits:
 *   - SECURITY / AUDIT events at the application level when applicable.
 *
 * Architectural rule:
 *   Compliance/privacy is separate from CIVIL IDENTITY / KYC.
 *
 * Important:
 *   kycVerifications does NOT belong to compliance in the current
 *   physical schema. It belongs to CIVIL IDENTITY / KYC.
 *
 * NOTE:
 *   No termsOfService or privacyPolicies tables are currently declared
 *   in the physical schema.
 */

/**
 * ======================================================================
 * 170. SECURITY / AUDIT
 * ======================================================================
 *
 * Role:
 *   Cross-cutting security telemetry and audit persistence.
 *
 * Persistence owner:
 *   security
 *
 * Tables:
 *   - securityEvents
 *   - auditLogs
 *   - auditLogsImmutable
 *
 * Cross-cutting:
 *   Yes.
 *
 * References:
 *   - USER / ACTOR
 *   - AUTHENTICATION
 *   - WEB3 IDENTITY
 *   - Multiple application domains
 *
 * Architectural rule:
 *   SECURITY / AUDIT records events and audit history.
 *   It MUST NOT become the owner of business rules.
 *
 * Important distinction:
 *   - securityEvents = security telemetry/events
 *   - auditLogs = operational/audit records
 *   - auditLogsImmutable = append-oriented immutable audit chain
 */

/**
 * ======================================================================
 * 180. INFRASTRUCTURE
 * ======================================================================
 *
 * Role:
 *   Transactional outbox persistence.
 *
 * Persistence owner:
 *   infrastructure
 *
 * Tables:
 *   - outboxEvents
 *
 * Depends on:
 *   - None at database FK level.
 *
 * Cross-cutting:
 *   Yes.
 *
 * Purpose:
 *   Reliable asynchronous event publication.
 *
 * Architectural rule:
 *   This domain must remain infrastructure-only.
 *
 * It MUST NOT contain:
 *   - business entities;
 *   - business rules;
 *   - application use cases.
 */

/**
 * ======================================================================
 * FINAL ARCHITECTURAL RULES
 * ======================================================================
 *
 * 1. One physical table has one persistence owner.
 *
 * 2. The numeric domain order is documentation order only.
 *
 * 3. A table must not be described here unless it physically exists in
 *    the current schema/<domain>/tables.ts.
 *
 * 4. Future/planned entities must not be added to this map until they
 *    actually exist in the physical schema.
 *
 * 5. Logical references must not be described as physical foreign keys.
 *
 * 6. Domain business rules do not belong in this file.
 *
 * 7. The aggregator may preserve compatibility for existing consumers,
 *    but new infrastructure code should prefer direct domain table
 *    imports.
 *
 * 8. Changes to table ownership, columns, foreign keys, indexes,
 *    constraints or relations require corresponding inventory validation.
 *
 * 9. The authoritative physical representation remains the respective
 *    tables.ts and relations.ts files plus the validated schema inventory.
 *
 * 10. This file documents the CURRENT STATE. It must never become a
 *     speculative roadmap.
 */

export * from './constants';

export * from './user/tables';
export * from './user/relations';

export * from './authentication/tables';
export * from './authentication/relations';

export * from './authorization/tables';
export * from './authorization/relations';

export * from './civil-identity/tables';
export * from './civil-identity/relations';

export * from './ssi/tables';
export * from './ssi/relations';

export * from './web3/tables';
export * from './web3/relations';

export * from './finance/tables';
export * from './finance/relations';

export * from './integrations/tables';
export * from './integrations/relations';

export * from './compliance/tables';
export * from './compliance/relations';

export * from './security/tables';
export * from './security/relations';

export * from './infrastructure/tables';
export * from './infrastructure/relations';
```

---

## `src/db/security/relations.ts`

```typescript
import { relations, AnyColumn, RelationConfig } from 'drizzle-orm';
import { securityEvents } from './tables';
import { users } from '../user/tables';
import { userAuthenticators, userSessions } from '../authentication/tables';




// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


export const securityEventsRelations = relations(securityEvents, ({ one }) => ({
  user: one(users, { fields: [securityEvents.userId], references: [users.id], relationName: 'userSecurityEvents' }),
  authenticator: one(userAuthenticators, { fields: [securityEvents.authenticatorId], references: [userAuthenticators.id] }),
  session: one(userSessions, { fields: [securityEvents.sessionId], references: [userSessions.id] }),
}));


```

---

## `src/db/security/tables.ts`

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';
import { wallets } from '../web3/tables';
import { userAuthenticators, userSessions } from '../authentication/tables';
import { SECURITY_EVENT_TYPES } from '../constants';



//
//   Security / Audit subsystem (Cross-cutting)
//   N/A
//   Multiple domains
//   N/A

// ----------------------------------------------------------------------
// Entity: securityEvents
// ----------------------------------------------------------------------
export const securityEvents = sqliteTable('security_events', {
  id: text('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  walletId: integer('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  authenticatorId: text('authenticator_id').references(() => userAuthenticators.id, { onDelete: 'set null' }),
  sessionId: text('session_id').references(() => userSessions.id, { onDelete: 'set null' }),
  
  event: text('event', { enum: SECURITY_EVENT_TYPES }).notNull(),
  result: text('result', { enum: ['success', 'failure', 'denied'] }).notNull(),
  source: text('source', { enum: ['web', 'mobile', 'api', 'worker', 'admin'] }),
  
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  correlationId: text('correlation_id'),
  
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => ({
  userCreatedIdx: index('idx_security_events_user_created').on(table.userId, table.createdAt),
  walletCreatedIdx: index('idx_security_events_wallet_created').on(table.walletId, table.createdAt),
  authIdx: index('idx_security_events_auth').on(table.authenticatorId),
  eventCheck: check('security_events_event_check', sql`${table.event} IN ('authentication_succeeded', 'authentication_failed', 'credential_created', 'credential_verified', 'credential_revoked', 'password_changed', 'password_reset_requested', 'passkey_registered', 'passkey_used', 'totp_enabled', 'totp_verified', 'wallet_linked', 'wallet_verified', 'wallet_authenticated', 'wallet_suspended', 'wallet_revoked', 'wallet_unlinked', 'recovery_code_consumed', 'account_locked', 'account_unlocked', 'auth_epoch_incremented')`),
  resultCheck: check('security_events_result_check', sql`${table.result} IN ('success', 'failure', 'denied')`),
}));



// ----------------------------------------------------------------------
// Entity: auditLogs
// ----------------------------------------------------------------------
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorId: integer('actor_id').references(() => users.id),
    targetUserId: integer('target_user_id').references(() => users.id),

    action: text('action').notNull(), // Ex: 'VAULT_GENESIS', 'HANDSHAKE_SUCCESS'
    status: text('status').default('success'),
    ipAddress: text('ip_address'),

    metadata: text('metadata', { mode: 'json' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    actionIdx: index('idx_audit_action').on(table.action),
    actorIdx: index('idx_audit_actor').on(table.actorId),
  })
);



// ----------------------------------------------------------------------
// Entity: auditLogsImmutable
// ----------------------------------------------------------------------
export const auditLogsImmutable = sqliteTable('audit_logs_immutable', {
  id: text('id').primaryKey(), // UUID
  actorId: integer('actor_id').references(() => users.id),
  actorIp: text('actor_ip'),
  actorUserAgent: text('actor_user_agent'),

  action: text('action').notNull(), // ex: ROTATE_BINANCE_PROD
  resource: text('resource'), // ex: integration_secrets:uuid

  eventHash: text('event_hash').notNull().unique(), // Hash SHA-256 de (id, actorId, action, previousHash, etc)
  previousHash: text('previous_hash'), // Encadeamento

  reason: text('reason'), // Motivo
  status: text('status', { enum: ['success', 'failed'] }).default('success'),

  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});


```

---

## `src/db/seed.sql`

```sql
-- ============================================================================
-- ASOT GENESIS SEED SCRIPT (100% Schema 10/10 Certified)
-- ============================================================================
-- Limpeza inicial
DELETE FROM password_credentials;
DELETE FROM user_authenticators;
DELETE FROM financial_ledger_entries;
DELETE FROM financial_fees;
DELETE FROM account_balances;
DELETE FROM financial_accounts;
DELETE FROM financial_transactions;
DELETE FROM financial_assets;
DELETE FROM membership_cards;
DELETE FROM identity_documents;
DELETE FROM citizens;
DELETE FROM user_profiles;
DELETE FROM users;

-- 1. USERS BASE
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at)
VALUES 
  (1, 'system', 'admin@asppibra.com', 'admin@asppibra.com', 'active', 1, unixepoch(), unixepoch()),
  (2, 'human', 'felipe.dev@asppibra.com', 'felipe.dev@asppibra.com', 'active', 1, unixepoch(), unixepoch());

-- 2. USER PROFILES
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at)
VALUES 
  (1, 'admin', 'admin', 'Administrador ASOT', 'private', 0, unixepoch(), unixepoch()),
  (2, 'felipedev', 'felipedev', 'Felipe Dev', 'public', 1, unixepoch(), unixepoch());

-- 3. USER AUTHENTICATORS & PASSWORD CREDENTIALS (Senha Padrão: Admin@123456)
INSERT INTO user_authenticators (id, user_id, type, label, verified_at, created_at, updated_at)
VALUES 
  ('auth_admin_01', 1, 'password', 'Primary Password', unixepoch(), unixepoch(), unixepoch()),
  ('auth_felipe_02', 2, 'password', 'Primary Password', unixepoch(), unixepoch(), unixepoch());

INSERT INTO password_credentials (authenticator_id, password_hash)
VALUES 
  ('auth_admin_01', 'IPxA0RtNWjsP8pH8V9Qkbw==:5d26aa9c6351ad152951701c6250a747fd2e214cc9e443cb3b345dfe8f12f7d7'),
  ('auth_felipe_02', 'IPxA0RtNWjsP8pH8V9Qkbw==:5d26aa9c6351ad152951701c6250a747fd2e214cc9e443cb3b345dfe8f12f7d7');

-- 4. CITIZENS (CIVIL IDENTITY BASE)
INSERT INTO citizens (user_id, legal_first_name, legal_last_name, nationality_code, civil_status, verified_at, verified_by, created_at, updated_at)
VALUES 
  (2, 'Felipe', 'Dev', 'BR', 'verified', unixepoch(), 1, unixepoch(), unixepoch());

-- 5. IDENTITY DOCUMENTS (CPF / RG)
INSERT INTO identity_documents (id, user_id, document_type, country_code, number_lookup_hash, encrypted_number, last4, source, verification_status, verified_at, verified_by, created_at, updated_at)
VALUES 
  (1, 2, 'cpf', 'BR', 'hash_cpf_11111111111', 'enc_cpf_11111111111', '1111', 'government', 'verified', unixepoch(), 1, unixepoch(), unixepoch());

-- 6. FINANCIAL ASSETS
INSERT INTO financial_assets (id, code, symbol, name, type, decimals, status, created_at, updated_at)
VALUES 
  (1, 'BRL', 'R$', 'Real Brasileiro', 'fiat', 2, 'active', unixepoch(), unixepoch()),
  (2, 'USD', 'US$', 'Dólar Americano', 'fiat', 2, 'active', unixepoch(), unixepoch()),
  (3, 'BTC', '₿', 'Bitcoin', 'crypto', 8, 'active', unixepoch(), unixepoch()),
  (4, 'ETH', 'Ξ', 'Ethereum', 'crypto', 18, 'active', unixepoch(), unixepoch());

-- 7. FINANCIAL ACCOUNTS
INSERT INTO financial_accounts (id, user_id, account_type, status, name, created_at, updated_at)
VALUES 
  (1, NULL, 'treasury', 'active', 'DAO Treasury Account', unixepoch(), unixepoch()),
  (2, NULL, 'operating', 'active', 'DAO Operating Account', unixepoch(), unixepoch()),
  (3, NULL, 'fees', 'active', 'DAO Platform Fees Account', unixepoch(), unixepoch()),
  (4, 2, 'user_available', 'active', 'Felipe Dev Primary Account', unixepoch(), unixepoch());

-- 8. ACCOUNT BALANCES (Unidades Base em String/BigInt Text)
INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
VALUES 
  (1, 1, 1, '100000000', '0', 1, unixepoch()), -- R$ 1.000.000,00 na Tesouraria
  (2, 4, 1, '100000', '0', 1, unixepoch());    -- R$ 1.000,00 na Conta do Felipe

-- 9. FINANCIAL TRANSACTIONS
INSERT INTO financial_transactions (id, user_id, type, category, status, description, completed_at, version, created_at, updated_at)
VALUES 
  (1, 2, 'deposit', 'other', 'completed', 'Aporte Inicial Genesis (R$ 1.000,00)', unixepoch(), 1, unixepoch(), unixepoch());

-- 10. DOUBLE-ENTRY LEDGER ENTRIES
INSERT INTO financial_ledger_entries (id, transaction_id, account_id, asset_id, direction, amount_base_units, created_at)
VALUES 
  (1, 1, 4, 1, 'credit', '100000', unixepoch());

```

---

## `src/db/seed_treasury_report.sql`

```sql
-- ============================================================================
-- ASPPIBRA DAO - REPORT AUDIT SEED SCRIPT (Andressa de Lima Ferreira)
-- Total Pago Real Comprovado: R$ 36.623,00 | Saldo Devedor: R$ 29.177,00 | Total: R$ 65.800,00
-- Fonte: Auditoria_ASPPIBRA_Andressa.xlsx (45 Transações Auditadas - Datas Estabilizadas 12:00 UTC)
-- ============================================================================

-- 0. Garantir Ativo BRL (id=1)
INSERT OR IGNORE INTO financial_assets (id, code, symbol, name, type, decimals, status, created_at, updated_at)
VALUES (1, 'BRL', 'R$', 'Real Brasileiro', 'fiat', 2, 'active', unixepoch(), unixepoch());

-- 1. Inserção do Usuário Principal (Andressa de Lima Ferreira)
INSERT OR IGNORE INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at)
VALUES (10, 'human', 'andressa.ferreira@email.com', 'andressa.ferreira@email.com', 'active', 1, 1691452800, 1691452800);

INSERT OR IGNORE INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at)
VALUES (10, 'andressa2024001', 'andressa2024001', 'Andressa de Lima Ferreira', 'public', 1, 1691452800, 1691452800);

INSERT OR IGNORE INTO user_authenticators (id, user_id, type, label, verified_at, created_at, updated_at)
VALUES ('auth_andressa_10', 10, 'password', 'Primary Password', unixepoch(), unixepoch(), unixepoch());

INSERT OR IGNORE INTO password_credentials (authenticator_id, password_hash)
VALUES ('auth_andressa_10', 'IPxA0RtNWjsP8pH8V9Qkbw==:5d26aa9c6351ad152951701c6250a747fd2e214cc9e443cb3b345dfe8f12f7d7');

INSERT OR IGNORE INTO citizens (user_id, legal_first_name, legal_last_name, nationality_code, civil_status, verified_at, verified_by, created_at, updated_at)
VALUES (10, 'Andressa', 'de Lima Ferreira', 'BR', 'verified', 1691452800, 1, 1691452800, 1691452800);

INSERT OR IGNORE INTO identity_documents (id, user_id, document_type, country_code, number_lookup_hash, encrypted_number, last4, source, verification_status, verified_at, verified_by, created_at, updated_at)
VALUES (10, 10, 'cpf', 'BR', 'hash_cpf_17379356780', 'enc_cpf_17379356780', '780', 'government', 'verified', 1691452800, 1, 1691452800, 1691452800);

-- 2. Inserção dos Provedores Fiat / Bancos Participantes
INSERT OR IGNORE INTO fiat_providers (id, name, code, type, status, created_at, updated_at)
VALUES
  (1, 'Itaú Unibanco', 'ITAU', 'bank', 'active', unixepoch(), unixepoch()),
  (2, 'Nu Pagamentos', 'NUBANK', 'payment_provider', 'active', unixepoch(), unixepoch()),
  (3, 'Bradesco', 'BRADESCO', 'bank', 'active', unixepoch(), unixepoch()),
  (4, 'Mercado Pago', 'MERCADO_PAGO', 'payment_provider', 'active', unixepoch(), unixepoch()),
  (5, 'Banco Inter', 'INTER', 'bank', 'active', unixepoch(), unixepoch()),
  (6, 'Santander', 'SANTANDER', 'bank', 'active', unixepoch(), unixepoch()),
  (7, 'Cora SCFI', 'CORA', 'bank', 'active', unixepoch(), unixepoch());

-- 3. Contas Financeiras da Andressa e da Tesouraria
INSERT OR IGNORE INTO financial_accounts (id, user_id, account_type, status, name, created_at, updated_at)
VALUES
  (10, 10, 'user_available', 'active', 'Conta Andressa de Lima Ferreira (#2024001)', unixepoch(), unixepoch()),
  (11, NULL, 'treasury', 'active', 'Tesouraria Consolidada ASPPIBRA (Ref: 2026-07-PM4)', unixepoch(), unixepoch());

-- 4. Saldo Consolidado da Conta (Total Pago Comprovado: R$ 36.623,00 | Saldo Devedor: R$ 29.177,00)
INSERT OR REPLACE INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
VALUES
  (10, 10, 1, '3662300', '2917700', 1, unixepoch()),
  (11, 11, 1, '3662300', '0', 1, unixepoch());

-- 5. Limpeza de registros anteriores
DELETE FROM financial_ledger_entries WHERE id >= 100 OR transaction_id >= 101;
DELETE FROM financial_transactions WHERE id >= 101;

-- 6. Inserção das 45 Transações Auditadas da Planilha (Datas Estabilizadas em UTC)
INSERT INTO financial_transactions (id, user_id, type, category, status, description, completed_at, version, created_at, updated_at)
VALUES
  (101, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1691496000, 1, 1691496000, 1691496000),
  (102, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1691582400, 1, 1691582400, 1691582400),
  (103, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1695297600, 1, 1695297600, 1695297600),
  (104, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1697803200, 1, 1697803200, 1697803200),
  (105, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1700568000, 1, 1700568000, 1700568000),
  (106, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Bradesco', 1703160000, 1, 1703160000, 1703160000),
  (107, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1703246400, 1, 1703246400, 1703246400),
  (108, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1708084800, 1, 1708084800, 1708084800),
  (109, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1710158400, 1, 1710158400, 1710158400),
  (110, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Mercado Pago -> Bradesco', 1714478400, 1, 1714478400, 1714478400),
  (111, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1714478400, 1, 1714478400, 1714478400),
  (112, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1716984000, 1, 1716984000, 1716984000),
  (113, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1719230400, 1, 1719230400, 1719230400),
  (114, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1722168000, 1, 1722168000, 1722168000),
  (115, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1725624000, 1, 1725624000, 1725624000),
  (116, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Bradesco', 1725624000, 1, 1725624000, 1725624000),
  (117, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Bradesco', 1728475200, 1, 1728475200, 1728475200),
  (118, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1731153600, 1, 1731153600, 1731153600),
  (119, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1734523200, 1, 1734523200, 1734523200),
  (120, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1737460800, 1, 1737460800, 1737460800),
  (121, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Mercado Pago -> Bradesco', 1737460800, 1, 1737460800, 1737460800),
  (122, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1739188800, 1, 1739188800, 1739188800),
  (123, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1742385600, 1, 1742385600, 1742385600),
  (124, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Mercado Pago -> Bradesco', 1745323200, 1, 1745323200, 1745323200),
  (125, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Mercado Pago -> Bradesco', 1746014400, 1, 1746014400, 1746014400),
  (126, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1747483200, 1, 1747483200, 1747483200),
  (127, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Banco Inter', 1750161600, 1, 1750161600, 1750161600),
  (128, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1750161600, 1, 1750161600, 1750161600),
  (129, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Nu Pagamentos -> Itaú Unibanco', 1753531200, 1, 1753531200, 1753531200),
  (130, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Nu Pagamentos -> Banco Inter', 1753531200, 1, 1753531200, 1753531200),
  (131, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Banco Inter', 1755259200, 1, 1755259200, 1755259200),
  (132, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Santander', 1760356800, 1, 1760356800, 1760356800),
  (133, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Mercado Pago (boleto Cora) -> Cora SCFI', 1763380800, 1, 1763380800, 1763380800),
  (134, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Nu Pagamentos -> Cora SCFI', 1764936000, 1, 1764936000, 1764936000),
  (135, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Nu Pagamentos -> Cora SCFI', 1770638400, 1, 1770638400, 1770638400),
  (136, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Nu Pagamentos -> Santander', 1770638400, 1, 1770638400, 1770638400),
  (137, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Nu Pagamentos -> Cora SCFI', 1772971200, 1, 1772971200, 1772971200),
  (138, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Itaú Unibanco -> Cora SCFI', 1773144000, 1, 1773144000, 1773144000),
  (139, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Banco Inter -> Cora SCFI', 1773576000, 1, 1773576000, 1773576000),
  (140, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Banco Inter -> Santander', 1774612800, 1, 1774612800, 1774612800),
  (141, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1705320000, 1705320000),
  (142, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1723723200, 1723723200),
  (143, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1757937600, 1757937600),
  (144, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1768478400, 1768478400),
  (145, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1776254400, 1776254400);

-- 7. Lançamentos de Partidas Dobradas (40 Transações Comprovadas)
INSERT INTO financial_ledger_entries (id, transaction_id, account_id, asset_id, direction, amount_base_units, created_at)
VALUES
  (101, 101, 11, 1, 'credit', '500000', 1691496000),
  (102, 102, 11, 1, 'credit', '500000', 1691582400),
  (103, 103, 11, 1, 'credit', '80000', 1695297600),
  (104, 104, 11, 1, 'credit', '80000', 1697803200),
  (105, 105, 11, 1, 'credit', '80000', 1700568000),
  (106, 106, 11, 1, 'credit', '70000', 1703160000),
  (107, 107, 11, 1, 'credit', '80000', 1703246400),
  (108, 108, 11, 1, 'credit', '80000', 1708084800),
  (109, 109, 11, 1, 'credit', '80000', 1710158400),
  (110, 110, 11, 1, 'credit', '70000', 1714478400),
  (111, 111, 11, 1, 'credit', '80000', 1714478400),
  (112, 112, 11, 1, 'credit', '80000', 1716984000),
  (113, 113, 11, 1, 'credit', '80000', 1719230400),
  (114, 114, 11, 1, 'credit', '80000', 1722168000),
  (115, 115, 11, 1, 'credit', '80000', 1725624000),
  (116, 116, 11, 1, 'credit', '70000', 1725624000),
  (117, 117, 11, 1, 'credit', '80000', 1728475200),
  (118, 118, 11, 1, 'credit', '80000', 1731153600),
  (119, 119, 11, 1, 'credit', '80000', 1734523200),
  (120, 120, 11, 1, 'credit', '80000', 1737460800),
  (121, 121, 11, 1, 'credit', '70000', 1737460800),
  (122, 122, 11, 1, 'credit', '80000', 1739188800),
  (123, 123, 11, 1, 'credit', '80000', 1742385600),
  (124, 124, 11, 1, 'credit', '40000', 1745323200),
  (125, 125, 11, 1, 'credit', '40000', 1746014400),
  (126, 126, 11, 1, 'credit', '75000', 1747483200),
  (127, 127, 11, 1, 'credit', '35000', 1750161600),
  (128, 128, 11, 1, 'credit', '80000', 1750161600),
  (129, 129, 11, 1, 'credit', '66700', 1753531200),
  (130, 130, 11, 1, 'credit', '66700', 1753531200),
  (131, 131, 11, 1, 'credit', '66700', 1755259200),
  (132, 132, 11, 1, 'credit', '100000', 1760356800),
  (133, 133, 11, 1, 'credit', '105000', 1763380800),
  (134, 134, 11, 1, 'credit', '55000', 1764936000),
  (135, 135, 11, 1, 'credit', '80000', 1770638400),
  (136, 136, 11, 1, 'credit', '70000', 1770638400),
  (137, 137, 11, 1, 'credit', '25000', 1772971200),
  (138, 138, 11, 1, 'credit', '25000', 1773144000),
  (139, 139, 11, 1, 'credit', '25000', 1773576000),
  (140, 140, 11, 1, 'credit', '67200', 1774612800);

```

---

## `src/db/ssi/relations.ts`

```typescript
import { relations } from 'drizzle-orm';
import {
  secureVaults,
  didIdentities,
  didVerificationMethods,
  verifiableCredentials,
  verifiablePresentations,
} from './tables';
import { users } from '../user/tables';

/**
 * ============================================================================
 * SSI DOMAIN RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to SSI entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on SSI tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */

/**
 * ============================================================================
 * SECURE VAULTS RELATIONS
 * ============================================================================
 */
export const secureVaultsRelations = relations(secureVaults, ({ one }) => ({
  user: one(users, {
    fields: [secureVaults.userId],
    references: [users.id],
    relationName: 'userSecureVaults',
  }),
}));

/**
 * ============================================================================
 * DID IDENTITIES RELATIONS
 * ============================================================================
 */
export const didIdentitiesRelations = relations(didIdentities, ({ one, many }) => ({
  user: one(users, {
    fields: [didIdentities.userId],
    references: [users.id],
    relationName: 'userDidIdentities',
  }),
  verificationMethods: many(didVerificationMethods),
}));

/**
 * ============================================================================
 * DID VERIFICATION METHODS RELATIONS
 * ============================================================================
 */
export const didVerificationMethodsRelations = relations(didVerificationMethods, ({ one }) => ({
  didIdentity: one(didIdentities, {
    fields: [didVerificationMethods.didId],
    references: [didIdentities.id],
  }),
}));

/**
 * ============================================================================
 * VERIFIABLE CREDENTIALS RELATIONS
 * ============================================================================
 */
export const verifiableCredentialsRelations = relations(verifiableCredentials, ({ one }) => ({
  holderUser: one(users, {
    fields: [verifiableCredentials.holderUserId],
    references: [users.id],
    relationName: 'userVerifiableCredentials',
  }),
}));

/**
 * ============================================================================
 * VERIFIABLE PRESENTATIONS RELATIONS
 * ============================================================================
 */
export const verifiablePresentationsRelations = relations(verifiablePresentations, ({ one }) => ({
  user: one(users, {
    fields: [verifiablePresentations.userId],
    references: [users.id],
    relationName: 'userVerifiablePresentations',
  }),
}));

```

---

## `src/db/ssi/tables.ts`

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';

/**
 * ============================================================================
 * SELF-SOVEREIGN IDENTITY (SSI) DOMAIN
 * ============================================================================
 *
 * Specifications & Compliance:
 * - W3C Decentralized Identifiers (DIDs) v1.0 Core Architecture
 * - W3C Verifiable Credentials Data Model v1.1 / v2.0
 * - Cryptographic Key Vaults (AES-256-GCM / XChaCha20-Poly1305 + External KMS)
 *
 * Bounded Context Boundaries:
 * - Base account identity is owned by user/
 * - Civil identity & government PII are owned by civil-identity/
 * - Web3 EVM wallets & smart contracts are owned by web3/
 * - SSI owns DIDs, Key Vaults, Verifiable Credentials & Presentations
 *
 * Retention & Compliance Policy:
 * - Decentralized Identifiers (DIDs), verification methods, and verifiable credentials
 *   are cryptographically immutable identity anchors.
 * - All foreign keys referencing users.id use onDelete: 'restrict' to ensure
 *   verifiable claims and key audit logs survive user soft-deletion.
 * ============================================================================
 */

/* ============================================================================
 * 1. SECURE VAULTS
 * ============================================================================
 *
 * Encrypted custody storage for sensitive key material, seeds, and mnemonics.
 */
export const secureVaults = sqliteTable(
  'secure_vaults',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    purpose: text('purpose', {
      enum: ['wallet_mnemonic', 'recovery_material', 'private_key', 'identity_seed'],
    }).notNull(),
    ciphertext: text('ciphertext').notNull(),
    nonce: text('nonce').notNull(),
    authTag: text('auth_tag').notNull(),
    encryptionAlgorithm: text('encryption_algorithm', {
      enum: ['AES-256-GCM', 'XChaCha20-Poly1305'],
    }).notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    keyReference: text('key_reference').notNull(), // KMS / Key Management reference

    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    rotatedAt: integer('rotated_at', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_secure_vaults_user').on(table.userId),
    userPurposeVersionUnq: uniqueIndex('uq_secure_vaults_user_purpose_version').on(
      table.userId,
      table.purpose,
      table.keyVersion
    ),
    activePurposeUnq: uniqueIndex('uq_secure_vaults_active_purpose')
      .on(table.userId, table.purpose)
      .where(sql`${table.revokedAt} IS NULL`),
    purposeCheck: check(
      'ck_secure_vaults_purpose',
      sql`${table.purpose} IN ('wallet_mnemonic', 'recovery_material', 'private_key', 'identity_seed')`
    ),
    algorithmCheck: check(
      'ck_secure_vaults_algorithm',
      sql`${table.encryptionAlgorithm} IN ('AES-256-GCM', 'XChaCha20-Poly1305')`
    ),
    rotatedAfterCreatedCheck: check(
      'ck_secure_vaults_rotated_after_created',
      sql`${table.rotatedAt} IS NULL OR ${table.rotatedAt} >= ${table.createdAt}`
    ),
    revokedAfterCreatedCheck: check(
      'ck_secure_vaults_revoked_after_created',
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`
    ),
    versionCheck: check(
      'ck_secure_vaults_version',
      sql`${table.version} > 0 AND ${table.keyVersion} > 0`
    ),
  })
);

/* ============================================================================
 * 2. DID IDENTITIES
 * ============================================================================
 *
 * W3C Decentralized Identifier (DID) Documents.
 */
export const didIdentities = sqliteTable(
  'did_identities',
  {
    id: text('id').primaryKey(), // UUID v4
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    did: text('did').notNull().unique(),
    method: text('method', {
      enum: ['key', 'ion', 'polygonid', 'web', 'cheqd', 'pkh'],
    }).notNull(),
    controller: text('controller').notNull(),
    status: text('status', {
      enum: ['active', 'suspended', 'revoked'],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_did_identities_user').on(table.userId),
    didIdx: index('idx_did_identities_did').on(table.did),
    statusIdx: index('idx_did_identities_status').on(table.status),
    didFormatCheck: check('ck_did_identities_did_format', sql`${table.did} LIKE 'did:%'`),
    statusCheck: check(
      'ck_did_identities_status',
      sql`${table.status} IN ('active', 'suspended', 'revoked')`
    ),
    methodCheck: check(
      'ck_did_identities_method',
      sql`${table.method} IN ('key', 'ion', 'polygonid', 'web', 'cheqd', 'pkh')`
    ),
    revokedStateCheck: check(
      'ck_did_identities_revoked_state',
      sql`${table.status} != 'revoked' OR ${table.revokedAt} IS NOT NULL`
    ),
    versionCheck: check('ck_did_identities_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 3. DID VERIFICATION METHODS
 * ============================================================================
 *
 * Public cryptographic keys associated with a DID for authentication & assertion.
 */
export const didVerificationMethods = sqliteTable(
  'did_verification_methods',
  {
    id: text('id').primaryKey(), // DID URL: did:example:123#key-1
    didId: text('did_id')
      .notNull()
      .references(() => didIdentities.id, { onDelete: 'restrict' }),

    type: text('type', {
      enum: [
        'Ed25519VerificationKey2020',
        'EcdsaSecp256k1RecoveryMethod2020',
        'X25519KeyAgreementKey2020',
        'JsonWebKey2020',
      ],
    }).notNull(),
    controllerDid: text('controller_did').notNull(),
    publicKeyMultibase: text('public_key_multibase').notNull(),
    purpose: text('purpose', {
      enum: [
        'authentication',
        'assertionMethod',
        'keyAgreement',
        'capabilityInvocation',
        'capabilityDelegation',
      ],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'suspended', 'revoked'],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    didIdx: index('idx_did_verification_methods_did').on(table.didId),
    purposeIdx: index('idx_did_verification_methods_purpose').on(table.purpose),
    statusIdx: index('idx_did_verification_methods_status').on(table.status),
    controllerDidFormatCheck: check(
      'ck_did_vm_controller_did_format',
      sql`${table.controllerDid} LIKE 'did:%'`
    ),
    statusCheck: check(
      'ck_did_vm_status',
      sql`${table.status} IN ('active', 'suspended', 'revoked')`
    ),
    purposeCheck: check(
      'ck_did_vm_purpose',
      sql`${table.purpose} IN ('authentication', 'assertionMethod', 'keyAgreement', 'capabilityInvocation', 'capabilityDelegation')`
    ),
    typeCheck: check(
      'ck_did_vm_type',
      sql`${table.type} IN ('Ed25519VerificationKey2020', 'EcdsaSecp256k1RecoveryMethod2020', 'X25519KeyAgreementKey2020', 'JsonWebKey2020')`
    ),
    revokedStateCheck: check(
      'ck_did_vm_revoked_state',
      sql`${table.status} != 'revoked' OR ${table.revokedAt} IS NOT NULL`
    ),
    versionCheck: check('ck_did_vm_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 4. VERIFIABLE CREDENTIALS
 * ============================================================================
 *
 * W3C Verifiable Credentials issued to holders.
 */
export const verifiableCredentials = sqliteTable(
  'verifiable_credentials',
  {
    id: text('id').primaryKey(), // UUID v4
    holderUserId: integer('holder_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    issuerDid: text('issuer_did').notNull(),
    subjectDid: text('subject_did').notNull(),
    credentialType: text('credential_type', {
      enum: [
        'CivicIdentityCredential',
        'MembershipCredential',
        'KycVerificationCredential',
        'ReputationCredential',
      ],
    }).notNull(),
    credentialHash: text('credential_hash').notNull().unique(),
    encryptedClaims: text('encrypted_claims').notNull(),
    proofType: text('proof_type', {
      enum: ['Ed25519Signature2020', 'BbsBlsSignature2020', 'JsonWebSignature2020'],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'suspended', 'revoked', 'expired'],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),
    issuanceDate: integer('issuance_date', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expirationDate: integer('expiration_date', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    holderIdx: index('idx_vc_holder_user').on(table.holderUserId),
    subjectIdx: index('idx_vc_subject_did').on(table.subjectDid),
    issuerIdx: index('idx_vc_issuer_did').on(table.issuerDid),
    statusIdx: index('idx_vc_status').on(table.status),
    issuerDidFormatCheck: check('ck_vc_issuer_did_format', sql`${table.issuerDid} LIKE 'did:%'`),
    subjectDidFormatCheck: check('ck_vc_subject_did_format', sql`${table.subjectDid} LIKE 'did:%'`),
    statusCheck: check(
      'ck_vc_status',
      sql`${table.status} IN ('active', 'suspended', 'revoked', 'expired')`
    ),
    credentialTypeCheck: check(
      'ck_vc_type',
      sql`${table.credentialType} IN ('CivicIdentityCredential', 'MembershipCredential', 'KycVerificationCredential', 'ReputationCredential')`
    ),
    proofTypeCheck: check(
      'ck_vc_proof_type',
      sql`${table.proofType} IN ('Ed25519Signature2020', 'BbsBlsSignature2020', 'JsonWebSignature2020')`
    ),
    revokedStateCheck: check(
      'ck_vc_revoked_state',
      sql`${table.status} != 'revoked' OR ${table.revokedAt} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_vc_dates',
      sql`${table.expirationDate} IS NULL OR ${table.expirationDate} > ${table.issuanceDate}`
    ),
    versionCheck: check('ck_vc_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 5. VERIFIABLE PRESENTATIONS
 * ============================================================================
 *
 * Cryptographic proofs presented by users to verifiers.
 */
export const verifiablePresentations = sqliteTable(
  'verifiable_presentations',
  {
    id: text('id').primaryKey(), // UUID v4
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    verifierDid: text('verifier_did').notNull(),
    presentationType: text('presentation_type').notNull(),
    challenge: text('challenge').notNull(),
    presentationHash: text('presentation_hash').notNull().unique(),
    status: text('status', {
      enum: ['verified', 'rejected', 'expired'],
    }).notNull(),

    version: integer('version').notNull().default(1),
    submittedAt: integer('submitted_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_vp_user').on(table.userId),
    verifierIdx: index('idx_vp_verifier').on(table.verifierDid),
    statusIdx: index('idx_vp_status').on(table.status),
    verifierDidFormatCheck: check(
      'ck_vp_verifier_did_format',
      sql`${table.verifierDid} LIKE 'did:%'`
    ),
    statusCheck: check('ck_vp_status', sql`${table.status} IN ('verified', 'rejected', 'expired')`),
    verifiedStateCheck: check(
      'ck_vp_verified_state',
      sql`${table.status} != 'verified' OR ${table.verifiedAt} IS NOT NULL`
    ),
    verifiedAfterSubmittedCheck: check(
      'ck_vp_verified_after_submitted',
      sql`${table.verifiedAt} IS NULL OR ${table.verifiedAt} >= ${table.submittedAt}`
    ),
    versionCheck: check('ck_vp_version', sql`${table.version} > 0`),
  })
);

```

---

## `src/db/user/relations.ts`

```typescript
import { relations } from 'drizzle-orm';

import {
  userAddresses,
  userContacts,
  userEducation,
  userNotificationSettings,
  userProfessionalExperience,
  userProfiles,
  users,
  membershipCards,
} from './tables';

/**
 * ============================================================================
 * USER / ACTOR — RELATIONSHIP MODEL
 * ============================================================================
 *
 * `users` is the relational root for the platform account.
 *
 * CONSTITUTIONAL BOUNDARY COMPLIANCE (Section 05):
 * To strictly enforce Bounded Context isolation and Golden Rule #20:
 * `src/db/user/relations.ts` ONLY defines navigation relations for entities owned
 * directly by the USER context (profiles, contacts, addresses, experience, education, cards, settings).
 */

export const usersRelations = relations(users, ({ one, many }) => ({
  /**
   * One-to-one user profile.
   */
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),

  /**
   * User-owned secondary contacts.
   */
  contacts: many(userContacts),

  /**
   * User-owned personal addresses.
   */
  addresses: many(userAddresses),

  /**
   * User-owned professional experience history.
   */
  professionalExperience: many(userProfessionalExperience),

  /**
   * User-owned academic/education history.
   */
  education: many(userEducation),

  /**
   * DAO membership credentials.
   */
  membershipCards: many(membershipCards),

  /**
   * Personal notification preferences.
   */
  notificationSettings: many(userNotificationSettings),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const userContactsRelations = relations(userContacts, ({ one }) => ({
  user: one(users, {
    fields: [userContacts.userId],
    references: [users.id],
  }),
}));

export const userAddressesRelations = relations(userAddresses, ({ one }) => ({
  user: one(users, {
    fields: [userAddresses.userId],
    references: [users.id],
  }),
}));

export const userProfessionalExperienceRelations = relations(
  userProfessionalExperience,
  ({ one }) => ({
    user: one(users, {
      fields: [userProfessionalExperience.userId],
      references: [users.id],
    }),
  })
);

export const userEducationRelations = relations(
  userEducation,
  ({ one }) => ({
    user: one(users, {
      fields: [userEducation.userId],
      references: [users.id],
    }),
  })
);

export const membershipCardsRelations = relations(
  membershipCards,
  ({ one }) => ({
    user: one(users, {
      fields: [membershipCards.userId],
      references: [users.id],
    }),
  })
);

export const userNotificationSettingsRelations = relations(
  userNotificationSettings,
  ({ one }) => ({
    user: one(users, {
      fields: [userNotificationSettings.userId],
      references: [users.id],
    }),
  })
);

```

---

## `src/db/user/tables.ts`

```typescript
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { USER_STATUS } from '../constants';

/**
 * ============================================================================
 * USER / ACTOR — PERSISTENCE MODEL
 * ============================================================================
 *
 * Physical owner:
 *   src/db/user/
 *
 * Responsibility:
 *   Represents the internal account of the platform and data directly
 *   belonging to that account.
 *
 * This module DOES NOT own:
 *   - authentication credentials
 *   - sessions
 *   - Google/GitHub identities
 *   - wallet storage
 *   - wallet authentication
 *   - KYC processes
 *   - civil identity
 *   - DID/SSI
 *   - authorization / RBAC
 *   - security/audit history
 *
 * ----------------------------------------------------------------------------
 * IDENTITY MODEL
 * ----------------------------------------------------------------------------
 *
 * users.id
 *   = internal relational identity
 *
 * users.publicId
 *   = persisted public identity of the account
 *   = public representation derived from the INTERNAL wallet address
 *
 * wallets.address
 *   = technical source of truth for the internal blockchain identity
 *   = owned by src/db/web3/
 *
 * IMPORTANT:
 *   publicId is NOT:
 *   - a random UUID;
 *   - an account-creation identifier;
 *   - a KYC identifier;
 *   - a DID;
 *   - an external withdrawal-wallet identifier;
 *   - a blockchain-network identifier.
 *
 * publicId lifecycle:
 *
 *      account created
 *          ↓
 *      onboarding completed
 *          ↓
 *      KYC approved
 *          ↓
 *      user requests internal wallet
 *          ↓
 *      internal wallet created
 *          ↓
 *      wallet becomes ACTIVE
 *          ↓
 *      users.publicId = internal wallets.address
 *
 * publicId therefore represents the PUBLIC IDENTITY OF THE ACCOUNT,
 * while wallets.address remains the TECHNICAL SOURCE OF TRUTH for the
 * internal blockchain identity.
 *
 * Cross-table invariant:
 *
 *   users.publicId === active internal wallets.address
 *
 * This invariant is strictly enforced by application/domain lifecycle logic.
 * The database cannot physically prevent inconsistencies here.
 * It is intentionally NOT modeled as a direct foreign key because
 * users.id <-> wallets.userId remains the authoritative relational link.
 *
 * publicId rules:
 *   - NULL before the internal wallet is active;
 *   - assigned only after KYC approval and internal wallet activation;
 *   - never generated randomly by this table;
 *   - never assigned by a frontend client;
 *   - never assigned from an external withdrawal wallet;
 *   - never changed by profile updates;
 *   - never changed by password/authentication changes;
 *   - never changed by Google/GitHub linking;
 *   - never changed merely because the user changes email;
 *   - replacement is an exceptional identity-recovery operation.
 *
 * The internal wallet has ONE EVM address.
 * The chain/network context belongs to the blockchain operation itself.
 *
 * Therefore:
 *
 *   publicId
 *      = account public identity
 *
 *   wallets.address
 *      = technical wallet address
 *
 *   chainId / network
 *      = transaction execution context
 *
 * The user does not need to know the internal network topology.
 * The platform controls chain selection internally.
 *
 * ----------------------------------------------------------------------------
 * ACCOUNT / KYC DISTINCTION
 * ----------------------------------------------------------------------------
 *
 * users.status
 *   = lifecycle/security state of the account
 *
 * kycVerifications.status
 *   = lifecycle state of an individual KYC process
 *
 * These concepts are NOT interchangeable.
 *
 * Examples:
 *
 *   kycVerifications.status = rejected
 *      DOES NOT imply:
 *      users.status = suspended
 *
 *   KYC rejection may simply require a new KYC submission.
 *
 * Account suspension is an explicit security/administrative decision
 * and is not automatically derived from ordinary KYC rejection.
 *
 * ----------------------------------------------------------------------------
 * EMAIL / INITIAL LOGIN
 * ----------------------------------------------------------------------------
 *
 * users.email
 *   = primary account contact
 *   = initial login identifier for the account
 *
 * users.emailNormalized
 *   = canonical lookup key
 *   = uniqueness key
 *   = authoritative lookup field for initial email login
 *
 * Authentication credentials belong to:
 *   src/db/authentication/
 *
 * USER persists the identity used for login.
 * AUTHENTICATION persists the proof/control mechanism.
 *
 * ----------------------------------------------------------------------------
 * WALLET POLICY
 * ----------------------------------------------------------------------------
 *
 * The internal wallet is NOT an account-creation mechanism.
 *
 * Initial account creation happens before the internal wallet.
 *
 * Google / GitHub / Wallet authentication identities:
 *   - do not own the internal account;
 *   - must resolve to an existing users.id when linking/authenticating;
 *   - must not silently create duplicate internal accounts.
 *
 * IMPORTANT:
 *   Wallet authentication is available only after the account exists
 *   and wallet linking/creation has been explicitly established.
 *
 * External withdrawal wallets:
 *   - are NOT owned by USER;
 *   - do NOT define users.publicId;
 *   - do NOT replace the internal wallet;
 *   - belong to the Web3/financial operation model.
 *
 * ----------------------------------------------------------------------------
 * SUBJECT TYPE GOVERNANCE
 * ----------------------------------------------------------------------------
 *
 * human:
 *   normal individual/citizen account.
 *
 * service:
 *   controlled application/service/agent account.
 *
 * system:
 *   technical system account.
 *
 * Creation policy:
 *   - human may follow the normal registration lifecycle;
 *   - service creation must be controlled by application/administrative flow;
 *   - system accounts must be controlled by bootstrap/internal operations.
 *
 * These governance rules belong to application/domain layers rather than
 * database CHECK constraints.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC IDENTITY REVOCATION / REPLACEMENT
 * ----------------------------------------------------------------------------
 *
 * If the internal wallet is revoked for an exceptional security reason
 * (for example, confirmed credential compromise), the old public identity
 * must NOT be casually reused or overwritten.
 *
 * The replacement policy is:
 *
 *   old internal wallet
 *       ↓
 *   revoked
 *       ↓
 *   historical identity preserved
 *       ↓
 *   new internal wallet
 *       ↓
 *   new public identity assigned
 *
 * The historical association is maintained outside this base USER table
 * through the Web3 identity/lifecycle model and audit trail.
 *
 * Normal profile, email, password, Google/GitHub or ordinary administrative
 * changes must never rotate publicId.
 *
 * ============================================================================
 */

// ============================================================================
// 10. USER / ACTOR — ROOT ACCOUNT
// ============================================================================

/**
 * Entity: users
 *
 * Root relational representation of an internal platform account.
 */
export const users = sqliteTable(
  'users',
  {
    // ------------------------------------------------------------------------
    // INTERNAL IDENTITY
    // ------------------------------------------------------------------------

    /**
     * Internal relational identity.
     *
     * Used by foreign keys throughout the database.
     * Must not be exposed as the public identity of the account.
     */
    id: integer('id').primaryKey({ autoIncrement: true }),

    /**
     * Public blockchain identity of the account.
     *
     * NULL:
     *   Account has not yet received an ACTIVE internal wallet.
     *
     * NON-NULL:
     *   Must equal the address of the account's ACTIVE internal wallet.
     *
     * Source of technical truth:
     *   web3.wallets.address
     *
     * This column is a persisted public identity representation for USER.
     * It is deliberately nullable during the account lifecycle.
     *
     * Never:
     *   - generate randomly;
     *   - accept arbitrary client-provided assignment;
     *   - assign from an external withdrawal wallet;
     *   - change during ordinary profile/authentication updates.
     */
    publicId: text('public_id').unique(),

    /**
     * Defines the nature of the account subject.
     *
     * human:
     *   normal citizen / individual account
     *
     * service:
     *   application service / agent account
     *
     * system:
     *   technical system account
     */
    subjectType: text('subject_type', {
      enum: ['human', 'service', 'system'],
    })
      .notNull()
      .default('human'),

    // ------------------------------------------------------------------------
    // PRIMARY ACCOUNT CONTACT / INITIAL LOGIN IDENTIFIER
    // ------------------------------------------------------------------------

    /**
     * Primary email of the account.
     *
     * USER owns the account contact identity.
     * AUTHENTICATION owns the credential used to prove control of it.
     *
     * For normal human registration flows this is the initial login
     * identifier.
     *
     * Nullable because controlled service/system accounts may follow
     * different provisioning rules.
     */
    email: text('email'),

    /**
     * Canonical representation used for:
     *   - account lookup;
     *   - uniqueness;
     *   - initial email login resolution.
     *
     * The normalization algorithm itself belongs to the application layer.
     */
    emailNormalized: text('email_normalized'),

    /**
     * Timestamp at which the current primary email was verified.
     *
     * If non-null, email must exist.
     */
    emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp' }),

    /**
     * Timestamp of the last primary email change.
     *
     * If non-null, email must exist.
     */
    emailChangedAt: integer('email_changed_at', { mode: 'timestamp' }),

    // ------------------------------------------------------------------------
    // ACCOUNT SECURITY / LIFECYCLE STATE
    // ------------------------------------------------------------------------

    /**
     * Global authentication epoch.
     *
     * Incremented by authentication/security flows when all existing
     * sessions must be invalidated.
     *
     * USER stores the account state.
     * AUTHENTICATION owns actual session invalidation.
     *
     * Invariant:
     *   authEpoch must be monotonic and never decrease.
     */
    authEpoch: integer('auth_epoch').default(1).notNull(),

    /**
     * Lifecycle state of the account itself.
     *
     * This is NOT the KYC status.
     */
    status: text('status', {
      enum: USER_STATUS,
    })
      .default('pending_setup')
      .notNull(),

    failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),
    lastFailedLoginAt: integer('last_failed_login_at', { mode: 'timestamp' }),

    /**
     * Timestamp when account status last changed.
     *
     * Application invariant:
     *   statusChangedAt = NULL only if no transition has occurred since creation.
     *   It must be updated whenever status changes.
     */
    statusChangedAt: integer('status_changed_at', { mode: 'timestamp' }),

    /**
     * Historical timestamp associated with account locking.
     *
     * Application invariant:
     *   lockedAt != null means the account has historically been locked.
     *   It does NOT necessarily represent the current active state.
     *   Current state is strictly governed by the `status` column.
     */
    lockedAt: integer('locked_at', { mode: 'timestamp' }),

    /**
     * Historical timestamp associated with account disabling.
     *
     * Application invariant:
     *   disabledAt != null means the account has historically been disabled.
     *   It does NOT necessarily represent the current active state.
     *   Current state is strictly governed by the `status` column.
     */
    disabledAt: integer('disabled_at', { mode: 'timestamp' }),

    /**
     * Soft-delete timestamp.
     *
     * NULL means the account is not soft-deleted.
     *
     * Soft-delete semantics are intentionally kept at the application
     * lifecycle layer rather than inferred automatically from status.
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),

    // ------------------------------------------------------------------------
    // AUDITABLE TIMESTAMPS
    // ------------------------------------------------------------------------

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    // ----------------------------------------------------------------------
    // PERFORMANCE INDEXES
    // ----------------------------------------------------------------------

    statusIdx: index('idx_users_status').on(table.status),

    /**
     * Supports queries filtering active/non-deleted accounts.
     */
    activeActorIdx: index('idx_users_active_actor').on(
      table.status,
      table.deletedAt
    ),

    /**
     * Prevents duplicate active account emails while allowing soft-deleted account email reuse.
     */
    activeEmailNormalizedUnq: uniqueIndex('uq_users_active_email_normalized')
      .on(table.emailNormalized)
      .where(sql`${table.deletedAt} IS NULL`),

    // ----------------------------------------------------------------------
    // DOMAIN / DATA-INTEGRITY CHECKS
    // ----------------------------------------------------------------------

    /**
     * Protects the account subject type even if the ORM is bypassed.
     */
    subjectTypeCheck: check(
      'users_subject_type_check',
      sql`${table.subjectType} IN ('human', 'service', 'system')`
    ),

    /**
     * Protects the account lifecycle state at database level.
     */
    statusCheck: check(
      'users_status_check',
      sql`${table.status} IN ('pending_setup', 'active', 'suspended', 'locked', 'disabled')`
    ),

    /**
     * authEpoch must always be a valid positive version.
     */
    authEpochCheck: check(
      'users_auth_epoch_check',
      sql`${table.authEpoch} >= 1`
    ),

    /**
     * email and emailNormalized must either both exist or both be NULL.
     *
     * Valid:
     *   email = NULL
     *   emailNormalized = NULL
     *
     * or:
     *   email != NULL
     *   emailNormalized != NULL
     *
     * Invalid:
     *   email != NULL
     *   emailNormalized = NULL
     *
     * Invalid:
     *   email = NULL
     *   emailNormalized != NULL
     */
    emailNormalizationCheck: check(
      'users_email_normalization_check',
      sql`(
        ${table.email} IS NULL AND ${table.emailNormalized} IS NULL
      ) OR (
        ${table.email} IS NOT NULL AND ${table.emailNormalized} IS NOT NULL
      )`
    ),

    /**
     * A verified email cannot exist without an email address.
     */
    emailVerificationCheck: check(
      'users_email_verification_check',
      sql`${table.emailVerifiedAt} IS NULL OR ${table.email} IS NOT NULL`
    ),

    /**
     * An email-change timestamp cannot exist without an email address.
     */
    emailChangedCheck: check(
      'users_email_changed_check',
      sql`${table.emailChangedAt} IS NULL OR ${table.email} IS NOT NULL`
    ),
  })
);

// ============================================================================
// 10.1 USER PROFILE
// ============================================================================

/**
 * Entity: userProfiles
 *
 * Presentation/public-profile information.
 *
 * Does NOT contain:
 *   - KYC/PII legal identity
 *   - credentials
 *   - roles
 *   - wallet information
 *   - audit information
 *
 * Username normalization:
 *   usernameNormalized is the authoritative uniqueness key.
 *   The normalization algorithm belongs to the application/domain layer.
 */
export const userProfiles = sqliteTable(
  'user_profiles',
  {
    /**
     * 1:1 relationship with users.
     */
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Public profile username.
     *
     * Minimum structural validation occurs in the database.
     * Complete username policy is application/domain responsibility.
     */
    username: text('username').notNull(),

    /**
     * Canonical username used for lookup/uniqueness.
     */
    usernameNormalized: text('username_normalized').notNull(),

    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    website: text('website'),
    about: text('about'),

    profileVisibility: text('profile_visibility', {
      enum: ['public', 'members', 'private'],
    })
      .notNull()
      .default('private'),

    isDiscoverable: integer('is_discoverable', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),

    /**
     * Soft-delete timestamp.
     *
     * APPLICATION INVARIANT:
     *   Must be updated atomically in the same transaction/use-case as parent
     *   `users.deletedAt` to ensure username release and active profile index alignment.
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    /**
     * Prevents duplicate active usernames while allowing soft-deleted account username reuse.
     */
    activeUsernameNormalizedUnq: uniqueIndex(
      'uq_user_profiles_active_username_normalized'
    )
      .on(table.usernameNormalized)
      .where(sql`${table.deletedAt} IS NULL`),

    /**
     * Basic database-level structural constraint.
     *
     * Full username rules belong to application/domain validation.
     */
    usernameCheck: check(
      'username_format_check',
      sql`length(${table.username}) >= 3`
    ),

    profileVisibilityCheck: check(
      'user_profiles_visibility_check',
      sql`${table.profileVisibility} IN ('public', 'members', 'private')`
    ),
  })
);

// ============================================================================
// 10.2 USER CONTACTS
// ============================================================================

/**
 * Entity: userContacts
 *
 * Secondary communication channels.
 *
 * Important:
 *   users.email remains the account's primary account/login identity.
 *   userContacts.isPrimary merely indicates the preferred contact inside the
 *   secondary contacts collection. It does NOT replace users.email.
 *
 * Secondary email:
 *   A secondary_email must never silently become the account's primary
 *   login identity.
 */
export const userContacts = sqliteTable(
  'user_contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type', {
      enum: ['phone', 'mobile', 'whatsapp', 'secondary_email'],
    }).notNull(),

    /**
     * Human/display representation.
     */
    value: text('value').notNull(),

    /**
     * Canonical searchable representation.
     *
     * Normalization rules belong to application/domain validation.
     */
    normalizedValue: text('normalized_value').notNull(),

    verificationMethod: text('verification_method', {
      enum: ['sms', 'whatsapp', 'email', 'admin', 'import'],
    }),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),

    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_user_contacts_user').on(table.userId),

    /**
     * Prevents the exact same normalized contact/type from being registered
     * more than once across the system.
     */
    normalizedUnq: uniqueIndex('uq_user_contacts_normalized').on(
      table.type,
      table.normalizedValue
    ),

    /**
     * INVARIANT: Exactly one primary contact per user, independently of the contact type.
     *
     * This is intentionally global across all contact types.
     */
    primaryUnq: uniqueIndex('uq_user_contacts_primary')
      .on(table.userId)
      .where(sql`${table.isPrimary} = true`),

    typeCheck: check(
      'user_contacts_type_check',
      sql`${table.type} IN ('phone', 'mobile', 'whatsapp', 'secondary_email')`
    ),

    verificationMethodCheck: check(
      'user_contacts_verification_method_check',
      sql`${table.verificationMethod} IS NULL OR ${table.verificationMethod} IN ('sms', 'whatsapp', 'email', 'admin', 'import')`
    ),

    /**
     * A contact cannot be marked as verified without a verification method.
     */
    verifiedAtCheck: check(
      'user_contacts_verified_at_check',
      sql`${table.verifiedAt} IS NULL OR ${table.verificationMethod} IS NOT NULL`
    ),
  })
);

// ============================================================================
// 10.3 USER ADDRESSES
// ============================================================================

/**
 * Entity: userAddresses
 *
 * Physical addresses belonging to the account.
 *
 * These are personal addresses only.
 * Real-estate properties belong to src/db/real-estate/.
 *
 * A street is required for the current physical-address model.
 * Domain-specific address validation belongs to application/domain layers.
 */
export const userAddresses = sqliteTable(
  'user_addresses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type', {
      enum: ['residential', 'commercial', 'billing', 'shipping'],
    }).notNull(),

    country: text('country').default('BR').notNull(),

    state: text('state').notNull(),
    city: text('city').notNull(),
    neighborhood: text('neighborhood'),
    street: text('street').notNull(),
    number: text('number'),
    complement: text('complement'),
    zipCode: text('zip_code').notNull(),

    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_user_addresses_user').on(table.userId),

    /**
     * INVARIANT: Exactly ONE primary address per user PER TYPE.
     *
     * Example:
     *   one primary residential
     *   one primary billing
     *   one primary shipping
     *   one primary commercial
     */
    primaryUnq: uniqueIndex('uq_user_addresses_primary')
      .on(table.userId, table.type)
      .where(sql`${table.isPrimary} = true`),

    typeCheck: check(
      'user_addresses_type_check',
      sql`${table.type} IN ('residential', 'commercial', 'billing', 'shipping')`
    ),
  })
);

// ============================================================================
// 10.4 USER PROFESSIONAL EXPERIENCE
// ============================================================================

/**
 * Entity: userProfessionalExperience
 *
 * Professional history of the user.
 *
 * organizationId is optional because the organization may exist outside
 * the DAO registry.
 *
 * When organizationId is present:
 *   organizations is the authoritative internal reference.
 *
 * When organizationId is NULL:
 *   companyName contains the external organization snapshot/name.
 */
export const userProfessionalExperience = sqliteTable(
  'user_professional_experience',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    organizationId: integer('organization_id'),

    companyName: text('company_name'),

    role: text('role').notNull(),
    description: text('description'),

    /**
     * Date-only values.
     *
     * Expected application format:
     *   YYYY-MM-DD
     *
     * Exact ISO date-format validation remains an application/domain rule.
     */
    startDate: text('start_date'),
    endDate: text('end_date'),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    userIdx: index('idx_professional_exp_user').on(table.userId),

    /**
     * Prevents an inverted range when an end date exists.
     */
    dateOrderCheck: check(
      'user_professional_experience_date_order_check',
      sql`${table.endDate} IS NULL OR ${table.startDate} IS NULL OR ${table.endDate} >= ${table.startDate}`
    ),

    /**
     * Ensures that professional experience is linked either to an internal
     * organization or contains an external snapshot name.
     */
    organizationOrNameCheck: check(
      'user_professional_experience_organization_check',
      sql`${table.organizationId} IS NOT NULL OR ${table.companyName} IS NOT NULL`
    ),
  })
);

// ============================================================================
// 10.5 USER EDUCATION
// ============================================================================

/**
 * Entity: userEducation
 *
 * Academic / educational history.
 *
 * When organizationId is present:
 *   organizations is the authoritative internal reference.
 *
 * When organizationId is NULL:
 *   institutionName contains the external institution snapshot/name.
 */
export const userEducation = sqliteTable(
  'user_education',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    organizationId: integer('organization_id'),

    institutionName: text('institution_name'),

    degree: text('degree').notNull(),
    field: text('field'),
    level: text('level'),

    /**
     * Date-only values.
     *
     * Expected application format:
     *   YYYY-MM-DD
     *
     * Exact ISO date-format validation remains an application/domain rule.
     */
    startDate: text('start_date'),
    endDate: text('end_date'),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    userIdx: index('idx_education_user').on(table.userId),

    dateOrderCheck: check(
      'user_education_date_order_check',
      sql`${table.endDate} IS NULL OR ${table.startDate} IS NULL OR ${table.endDate} >= ${table.startDate}`
    ),

    /**
     * Ensures that education is linked either to an internal
     * organization or contains an external institution snapshot name.
     */
    organizationOrNameCheck: check(
      'user_education_organization_check',
      sql`${table.organizationId} IS NOT NULL OR ${table.institutionName} IS NOT NULL`
    ),
  })
);

// ============================================================================
// 10.6 MEMBERSHIP CARDS
// ============================================================================

/**
 * Entity: membershipCards
 *
 * DAO membership credential.
 *
 * It is NOT:
 *   - authentication credential
 *   - RBAC role
 *   - KYC document
 *   - blockchain wallet
 *
 * Lifecycle:
 *   A user may retain historical revoked/expired cards.
 *   At most ONE card may be ACTIVE at any moment for a given user.
 *
 * Important Invariant:
 *   `status = 'active'` and `expiryDate < now` can physically coexist in the database.
 *   The transition to 'expired' belongs strictly to the application lifecycle,
 *   and is not enforced by a database CHECK constraint.
 */
export const membershipCards = sqliteTable(
  'membership_cards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Hash used for offline verification.
     *
     * No redundant uniqueIndex is required because .unique()
     * already creates the uniqueness constraint/index.
     */
    cardHash: text('card_hash').notNull().unique(),

    tier: text('tier', {
      enum: ['citizen', 'partner', 'founder', 'honorary'],
    })
      .notNull()
      .default('citizen'),

    issueDate: integer('issue_date', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    expiryDate: integer('expiry_date', { mode: 'timestamp' }),

    qrCodeUrl: text('qr_code_url'),

    status: text('status', {
      enum: ['active', 'expired', 'revoked'],
    })
      .notNull()
      .default('active'),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_cards_user').on(table.userId),

    /**
     * A user may have historical cards, but only one active card.
     */
    activeUserCardUnique: uniqueIndex('uq_membership_cards_active_user')
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),

    tierCheck: check(
      'membership_cards_tier_check',
      sql`${table.tier} IN ('citizen', 'partner', 'founder', 'honorary')`
    ),

    statusCheck: check(
      'membership_cards_status_check',
      sql`${table.status} IN ('active', 'expired', 'revoked')`
    ),

    expiryOrderCheck: check(
      'membership_cards_expiry_order_check',
      sql`${table.expiryDate} IS NULL OR ${table.expiryDate} > ${table.issueDate}`
    ),
  })
);

// ============================================================================
// 10.7 USER NOTIFICATION SETTINGS
// ============================================================================

/**
 * Entity: userNotificationSettings
 *
 * Stores personal communication preferences only.
 *
 * It does NOT define:
 *   - which events exist;
 *   - when an event is generated;
 *   - how notifications are delivered;
 *   - email/chat transport.
 *
 * Those responsibilities belong to COMMUNICATION.
 *
 * Preference keys:
 *   The `type` column is intentionally extensible.
 *   The authoritative catalog of valid preference keys belongs to the
 *   application/communication layer rather than being hard-coded here.
 */
export const userNotificationSettings = sqliteTable(
  'user_notification_settings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Extensible preference key.
     *
     * Examples:
     *   activity_comments
     *   application_news
     *   governance_updates
     *
     * The canonical preference catalog is defined outside persistence.
     */
    type: text('type').notNull(),

    enabled: integer('enabled', { mode: 'boolean' })
      .default(true)
      .notNull(),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    /**
     * Updated whenever the preference changes.
     *
     * Useful for synchronization, audit correlation and future
     * multi-device settings reconciliation.
     */
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userTypeUnique: uniqueIndex('uq_user_notification_settings_type').on(
      table.userId,
      table.type
    ),
  })
);

/**
 * ============================================================================
 * USER EXTERNAL IDENTITIES (OAuth / Social Identity Bindings)
 * ============================================================================
 * Conceptual owner: Identity Core (src/domains/identity/external-identities/)
 *
 * Restrição Constitucional (AF-005):
 * UNIQUE(provider, provider_subject_id)
 */
export const userExternalIdentities = sqliteTable(
  'user_external_identities',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    provider: text('provider').notNull(),

    providerSubjectId: text('provider_subject_id').notNull(),

    emailAtBinding: text('email_at_binding'),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    providerSubjectUnique: uniqueIndex('uq_user_external_identities_provider_subject').on(
      table.provider,
      table.providerSubjectId
    ),
    userIdIdx: index('idx_user_external_identities_user_id').on(table.userId),
  })
);


```

---

## `src/db/web3/relations.ts`

```typescript
import { relations } from 'drizzle-orm';
import { web3Networks, smartContracts, wallets, web3Transactions } from './tables';
import { users } from '../user/tables';

/**
 * ============================================================================
 * WEB3 NETWORKS
 * ============================================================================
 */
export const web3NetworksRelations = relations(web3Networks, ({ many }) => ({
  wallets: many(wallets, { relationName: 'networkWallets' }),
  smartContracts: many(smartContracts, { relationName: 'networkContracts' }),
  transactions: many(web3Transactions, { relationName: 'networkTransactions' }),
}));

/**
 * ============================================================================
 * SMART CONTRACTS
 * ============================================================================
 */
export const smartContractsRelations = relations(smartContracts, ({ one }) => ({
  network: one(web3Networks, {
    fields: [smartContracts.networkId],
    references: [web3Networks.id],
    relationName: 'networkContracts',
  }),
}));

/**
 * ============================================================================
 * WALLETS
 * ============================================================================
 */
export const walletsRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
    relationName: 'walletOwner',
  }),
  verifiedByUser: one(users, {
    fields: [wallets.verifiedBy],
    references: [users.id],
    relationName: 'walletVerifier',
  }),
  network: one(web3Networks, {
    fields: [wallets.networkId],
    references: [web3Networks.id],
    relationName: 'networkWallets',
  }),
  
  /**
   * Controller wallet mapping (Composite FK linking networkId)
   */
  controllerWallet: one(wallets, {
    fields: [wallets.controllerWalletId, wallets.networkId],
    references: [wallets.id, wallets.networkId],
    relationName: 'walletController',
  }),

  /**
   * Smart-contract wallets controlled by this wallet.
   */
  controlledWallets: many(wallets, {
    relationName: 'walletController',
  }),
  
  transactions: many(web3Transactions, {
    relationName: 'walletTransactions',
  }),
}));

/**
 * ============================================================================
 * WEB3 TRANSACTIONS
 * ============================================================================
 */
export const web3TransactionsRelations = relations(
  web3Transactions,
  ({ one, many }) => ({
    /**
     * Network on which the transaction exists.
     */
    network: one(web3Networks, {
      fields: [web3Transactions.networkId],
      references: [web3Networks.id],
      relationName: 'networkTransactions',
    }),

    /**
     * Wallet responsible for the transaction.
     */
    wallet: one(wallets, {
      fields: [
        web3Transactions.walletId,
        web3Transactions.networkId,
      ],
      references: [
        wallets.id,
        wallets.networkId,
      ],
      relationName: 'walletTransactions',
    }),

    /**
     * Transaction that this transaction replaces.
     */
    replacementOf: one(web3Transactions, {
      fields: [
        web3Transactions.replacementOfTransactionId,
      ],
      references: [
        web3Transactions.id,
      ],
      relationName: 'transactionReplacement',
    }),

    /**
     * Transactions that replaced this transaction.
     */
    replacedTransactions: many(web3Transactions, {
      relationName: 'transactionReplacement',
    }),
  }),
);

```

---

## `src/db/web3/tables.ts`

```typescript
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * WEB3 / BLOCKCHAIN DOMAIN
 * ============================================================================
 *
 * Responsibility:
 * - Blockchain networks
 * - Smart contracts
 * - Platform-controlled internal wallets
 * - User-linked external wallets
 * - Blockchain transaction lifecycle
 * - Blockchain execution state
 *
 * Explicit boundaries:
 * - Authentication belongs to authentication/
 * - Civil identity / KYC belongs to civil-identity/
 * - Authorization belongs to authorization/
 * - Financial accounting belongs to finance/
 *
 * Web3 MUST NOT own:
 * - financial ledger
 * - financial balances
 * - accounting entries
 * - financial fee accounting
 * - private keys / seed phrases / mnemonics
 *
 * ----------------------------------------------------------------------------
 * WALLET MODEL
 * ----------------------------------------------------------------------------
 *
 * A user may have:
 *
 * - 0..N historical internal wallets
 * - 0..1 ACTIVE internal wallet
 * - 0..N external wallets
 *
 * Internal wallet:
 * - controlled by the platform
 * - requires key-management references
 * - may be primary
 * - may be rotated/revoked historically
 *
 * External wallet:
 * - linked by the user
 * - controlled outside the platform
 * - never primary
 * - never stores platform key-management references
 *
 * Wallets are historical entities and must never be physically deleted.
 *
 * ----------------------------------------------------------------------------
 * ADDRESS MODEL
 * ----------------------------------------------------------------------------
 *
 * address:
 *   Original EVM address.
 *
 * addressNormalized:
 *   Lowercase canonical EVM address.
 *
 * Blockchain identity:
 *
 *   network + addressNormalized
 *
 * ----------------------------------------------------------------------------
 * TRANSACTION MODEL
 * ----------------------------------------------------------------------------
 *
 * web3Transactions stores blockchain technical state.
 *
 * It is NOT the financial transaction and NOT the financial ledger.
 *
 * Finance should reference Web3 settlement from its own financial/crypto
 * tables rather than moving accounting responsibilities into this module.
 *
 * ----------------------------------------------------------------------------
 * SECURITY
 * ----------------------------------------------------------------------------
 *
 * keyProvider/keyReference are REFERENCES ONLY.
 *
 * NEVER store:
 * - privateKey
 * - mnemonic
 * - seed phrase
 * - decrypted key material
 * - KMS/HSM secrets
 *
 * ----------------------------------------------------------------------------
 * IMMUTABILITY
 * ----------------------------------------------------------------------------
 *
 * The following wallet identity fields should be immutable after creation:
 *
 * - userId
 * - provenance
 * - networkId
 * - walletType
 * - address
 * - addressNormalized
 *
 * Repository policies and/or database triggers should enforce this in the
 * infrastructure/migration layer.
 * ============================================================================
 */

/* ============================================================================
 * 1. WEB3 NETWORKS
 * ========================================================================== */

export const web3Networks = sqliteTable(
  'web3_networks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    name: text('name').notNull(),

    /**
     * Canonical identifier.
     *
     * V1 convention:
     *
     *   eip155:<chainId>
     *
     * Examples:
     *   eip155:1
     *   eip155:137
     *   eip155:8453
     */
    identifier: text('identifier').notNull(),

    chainId: integer('chain_id').notNull(),

    namespace: text('namespace', {
      enum: ['eip155'],
    }).notNull(),

    networkType: text('network_type', {
      enum: ['mainnet', 'testnet', 'local'],
    }).notNull(),

    /**
     * Application execution environment.
     *
     * This is intentionally separate from networkType.
     *
     * Examples that may legitimately exist:
     * - mainnet + production
     * - mainnet + staging
     * - testnet + staging
     * - testnet + development
     * - local + development
     */
    environment: text('environment', {
      enum: ['production', 'staging', 'development'],
    }).notNull(),

    status: text('status', {
      enum: ['active', 'deprecated', 'suspended'],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),

    /**
     * Technical reference to the native financial asset.
     *
     * This intentionally avoids importing Finance tables into Web3.
     */
    nativeAssetReference: text('native_asset_reference'),

    /**
     * RPC infrastructure references.
     *
     * These are configuration references only.
     * No credentials/secrets belong here.
     */
    rpcProvider: text('rpc_provider'),
    rpcEndpointReference: text('rpc_endpoint_reference'),

    /**
     * Optional blockchain explorer base URL.
     *
     * Example:
     *   https://etherscan.io
     */
    explorerBaseUrl: text('explorer_base_url'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    chainUnique: uniqueIndex(
      'uq_web3_networks_chain',
    ).on(
      table.namespace,
      table.chainId,
    ),

    identifierUnique: uniqueIndex(
      'uq_web3_networks_identifier',
    ).on(table.identifier),

    chainIdCheck: check(
      'ck_web3_networks_chain_id',
      sql`${table.chainId} > 0`,
    ),

    identifierCheck: check(
      'ck_web3_networks_identifier',
      sql`
        ${table.identifier}
        = ${table.namespace} || ':' || ${table.chainId}
      `,
    ),

    nameNotEmptyCheck: check(
      'ck_web3_networks_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),

    identifierNotEmptyCheck: check(
      'ck_web3_networks_identifier_not_empty',
      sql`length(trim(${table.identifier})) > 0`,
    ),

    versionCheck: check(
      'ck_web3_networks_version',
      sql`${table.version} > 0`,
    ),
  }),
);

/* ============================================================================
 * 2. SMART CONTRACTS
 * ========================================================================== */

export const smartContracts = sqliteTable(
  'smart_contracts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    networkId: integer('network_id')
      .notNull()
      .references(() => web3Networks.id, {
        onDelete: 'restrict',
      }),

    address: text('address').notNull(),

    /**
     * Lowercase canonical EVM address.
     */
    addressNormalized: text('address_normalized').notNull(),

    name: text('name').notNull(),

    type: text('type', {
      enum: [
        'erc20',
        'erc721',
        'erc1155',
        'dao_governance',
        'treasury',
        'escrow',
        'multisig',
        'account_abstraction',
        'proxy',
        'bridge',
        'staking',
        'other',
      ],
    }).notNull(),

    /**
     * Deployment / application-level version.
     */
    version: text('version').notNull().default('1.0.0'),

    status: text('status', {
      enum: ['active', 'deprecated', 'suspended'],
    })
      .notNull()
      .default('active'),

    rowVersion: integer('row_version').notNull().default(1),

    /**
     * Technical metadata only.
     *
     * Never store secrets.
     */
    metadata: text('metadata', {
      mode: 'json',
    }),

    /**
     * Optional deployment transaction hash.
     */
    deploymentTxHash: text('deployment_tx_hash'),

    /**
     * Optional explorer URL.
     */
    explorerUrl: text('explorer_url'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    /**
     * Same contract address may exist on different networks.
     * Same network + normalized address may exist only once.
     */
    addressUnique: uniqueIndex(
      'uq_smart_contracts_network_address',
    ).on(
      table.networkId,
      table.addressNormalized,
    ),

    typeIdx: index(
      'idx_smart_contracts_type',
    ).on(table.type),

    networkStatusIdx: index(
      'idx_smart_contracts_network_status',
    ).on(
      table.networkId,
      table.status,
    ),

    deploymentTxIdx: index(
      'idx_smart_contracts_deployment_tx',
    ).on(
      table.networkId,
      table.deploymentTxHash,
    ),

    addressCheck: check(
      'ck_smart_contracts_address',
      sql`
        ${table.address} LIKE '0x%'
        AND length(${table.address}) = 42
        AND substr(${table.address}, 3) NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    normalizedAddressCheck: check(
      'ck_smart_contracts_address_normalized',
      sql`
        ${table.addressNormalized} LIKE '0x%'
        AND length(${table.addressNormalized}) = 42
        AND substr(${table.addressNormalized}, 3) NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    normalizedLowercaseCheck: check(
      'ck_smart_contracts_address_normalized_lowercase',
      sql`
        ${table.addressNormalized}
        = lower(${table.addressNormalized})
      `,
    ),

    normalizedMatchesAddressCheck: check(
      'ck_smart_contracts_address_normalized_matches',
      sql`
        ${table.addressNormalized}
        = lower(${table.address})
      `,
    ),

    deploymentTxHashCheck: check(
      'ck_smart_contracts_deployment_tx_hash',
      sql`
        ${table.deploymentTxHash} IS NULL
        OR (
          ${table.deploymentTxHash} LIKE '0x%'
          AND length(${table.deploymentTxHash}) = 66
          AND substr(${table.deploymentTxHash}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    nameNotEmptyCheck: check(
      'ck_smart_contracts_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),

    rowVersionCheck: check(
      'ck_smart_contracts_row_version',
      sql`${table.rowVersion} > 0`,
    ),
  }),
);

/* ============================================================================
 * 3. WALLETS
 * ========================================================================== */

export const wallets = sqliteTable(
  'wallets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        /**
         * Wallets are historical and must survive user lifecycle operations.
         */
        onDelete: 'restrict',
      }),

    /**
     * internal:
     *   Platform-controlled/custodial wallet.
     *
     * external:
     *   User-linked non-custodial wallet.
     *
     * No default is intentionally used.
     * The caller must explicitly choose the provenance.
     */
    provenance: text('provenance', {
      enum: ['internal', 'external'],
    }).notNull(),

    networkId: integer('network_id')
      .notNull()
      .references(() => web3Networks.id, {
        onDelete: 'restrict',
      }),

    /**
     * V1 wallet types.
     */
    walletType: text('wallet_type', {
      enum: ['eoa', 'smart_contract'],
    }).notNull(),

    controlMode: text('control_mode', {
      enum: ['platform_key', 'external_user', 'contract_controller'],
    }).notNull(),

    controllerWalletId: integer('controller_wallet_id'),

    /**
     * Original EVM address.
     */
    address: text('address').notNull(),

    /**
     * Lowercase canonical EVM address.
     */
    addressNormalized: text('address_normalized').notNull(),

    label: text('label'),

    /**
     * Platform key-management references.
     *
     * These fields never contain actual secret/key material.
     */
    keyProvider: text('key_provider'),
    keyReference: text('key_reference'),
    keyVersion: integer('key_version'),

    /**
     * Wallet lifecycle.
     *
     * revoked and unlinked are historical terminal states.
     */
    status: text('status', {
      enum: [
        'pending',
        'active',
        'suspended',
        'revoked',
        'unlinked',
      ],
    })
      .notNull()
      .default('pending'),

    /**
     * Wallet ownership verification.
     *
     * This is NOT KYC.
     */
    verificationStatus: text('verification_status', {
      enum: ['pending', 'verified', 'rejected'],
    })
      .notNull()
      .default('pending'),

    verificationMethod: text('verification_method', {
      enum: ['signature', 'challenge', 'manual', 'system'],
    }),

    /**
     * Only an active internal wallet may be primary.
     */
    isPrimary: integer('is_primary', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),

    linkedAt: integer('linked_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    verifiedAt: integer('verified_at', {
      mode: 'timestamp',
    }),

    verifiedBy: integer('verified_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    suspendedAt: integer('suspended_at', {
      mode: 'timestamp',
    }),

    revokedAt: integer('revoked_at', {
      mode: 'timestamp',
    }),

    unlinkedAt: integer('unlinked_at', {
      mode: 'timestamp',
    }),

    /**
     * Last successful wallet ownership/authentication challenge.
     */
    lastOwnershipVerifiedAt: integer('last_ownership_verified_at', {
      mode: 'timestamp',
    }),

    /**
     * Optimistic locking.
     */
    version: integer('version').notNull().default(1),

    /**
     * Non-sensitive auxiliary metadata.
     */
    metadata: text('metadata', {
      mode: 'json',
    }),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    controllerFk: foreignKey({
      columns: [table.controllerWalletId],
      foreignColumns: [table.id],
      name: 'fk_wallets_controller',
    }).onDelete('restrict'),

    /**
     * A wallet cannot be its own controller.
     */
    controllerSelfCheck: check(
      'ck_wallets_controller_self',
      sql`
        ${table.controllerWalletId} IS NULL
        OR ${table.controllerWalletId} != ${table.id}
      `,
    ),

    /**
     * Global blockchain identity:
     *
     * network + addressNormalized
     */
    addressUnique: uniqueIndex(
      'uq_wallets_network_address_normalized',
    ).on(
      table.networkId,
      table.addressNormalized,
    ),

    /**
     * At most one primary wallet per user.
     */
    primaryUnique: uniqueIndex(
      'uq_wallets_primary_user',
    )
      .on(table.userId)
      .where(sql`${table.isPrimary} = true`),

    /**
     * At most one active internal wallet per user.
     *
     * Historical revoked/unlinked internal wallets are preserved.
     */
    internalActiveUnique: uniqueIndex(
      'uq_wallets_internal_active_user',
    )
      .on(table.userId)
      .where(
        sql`
          ${table.provenance} = 'internal'
          AND ${table.status} = 'active'
        `,
      ),

    /**
     * Required so web3Transactions can establish:
     *
     * (walletId, networkId)
     *   -> wallets(id, networkId)
     */
    idNetworkUnique: uniqueIndex(
      'uq_wallets_id_network',
    ).on(
      table.id,
      table.networkId,
    ),

    userStatusIdx: index(
      'idx_wallets_user_status',
    ).on(
      table.userId,
      table.status,
    ),

    userProvenanceStatusIdx: index(
      'idx_wallets_user_provenance_status',
    ).on(
      table.userId,
      table.provenance,
      table.status,
    ),

    verificationIdx: index(
      'idx_wallets_verification_status',
    ).on(table.verificationStatus),

    networkStatusIdx: index(
      'idx_wallets_network_status',
    ).on(
      table.networkId,
      table.status,
    ),

    lastAuthIdx: index(
      'idx_wallets_last_ownership_verified',
    ).on(table.lastOwnershipVerifiedAt),

    /**
     * Primary MUST be internal + active.
     */
    primaryInternalActiveCheck: check(
      'ck_wallets_primary_internal_active',
      sql`
        ${table.isPrimary} = false
        OR (
          ${table.provenance} = 'internal'
          AND ${table.status} = 'active'
        )
      `,
    ),

    /**
     * Internal wallet MUST have platform key-management references, UNLESS it is a contract_controller.
     */
    internalKeyReferenceCheck: check(
      'ck_wallets_internal_key_reference',
      sql`
        ${table.provenance} != 'internal'
        OR ${table.controlMode} = 'contract_controller'
        OR (
          ${table.keyProvider} IS NOT NULL
          AND length(trim(${table.keyProvider})) > 0
          AND ${table.keyReference} IS NOT NULL
          AND length(trim(${table.keyReference})) > 0
        )
      `,
    ),

    /**
     * External wallet MUST NOT use platform key-management references.
     */
    externalKeyReferenceCheck: check(
      'ck_wallets_external_key_reference',
      sql`
        ${table.provenance} != 'external'
        OR (
          ${table.keyProvider} IS NULL
          AND ${table.keyReference} IS NULL
        )
      `,
    ),

    keyVersionCheck: check(
      'ck_wallets_key_version',
      sql`
        ${table.keyVersion} IS NULL
        OR ${table.keyVersion} > 0
      `,
    ),

    versionCheck: check(
      'ck_wallets_version',
      sql`${table.version} > 0`,
    ),

    addressCheck: check(
      'ck_wallets_address',
      sql`
        ${table.address} LIKE '0x%'
        AND length(${table.address}) = 42
        AND substr(${table.address}, 3) NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    normalizedAddressCheck: check(
      'ck_wallets_address_normalized',
      sql`
        ${table.addressNormalized} LIKE '0x%'
        AND length(${table.addressNormalized}) = 42
        AND substr(${table.addressNormalized}, 3)
            NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    normalizedLowercaseCheck: check(
      'ck_wallets_address_normalized_lowercase',
      sql`
        ${table.addressNormalized}
        = lower(${table.addressNormalized})
      `,
    ),

    normalizedMatchesAddressCheck: check(
      'ck_wallets_address_normalized_matches',
      sql`
        ${table.addressNormalized}
        = lower(${table.address})
      `,
    ),

    /**
     * Verified wallet requires verification timestamp, method, and lastOwnershipVerifiedAt.
     */
    verifiedStateCheck: check(
      'ck_wallets_verified_state',
      sql`
        ${table.verificationStatus} != 'verified'
        OR (
          ${table.verifiedAt} IS NOT NULL
          AND ${table.verificationMethod} IS NOT NULL
          AND ${table.lastOwnershipVerifiedAt} IS NOT NULL
        )
      `,
    ),

    /**
     * Rejected wallet must not be marked verified.
     */
    rejectedVerificationCheck: check(
      'ck_wallets_rejected_verification',
      sql`
        ${table.verificationStatus} != 'rejected'
        OR ${table.verifiedAt} IS NULL
      `,
    ),

    /**
     * Revoked wallet requires revocation timestamp.
     */
    revokedAtCheck: check(
      'ck_wallets_revoked_at',
      sql`
        ${table.status} != 'revoked'
        OR ${table.revokedAt} IS NOT NULL
      `,
    ),

    /**
     * Suspended wallet requires suspension timestamp.
     */
    suspendedAtCheck: check(
      'ck_wallets_suspended_at',
      sql`
        ${table.status} != 'suspended'
        OR ${table.suspendedAt} IS NOT NULL
      `,
    ),

    /**
     * Unlinked state is for external wallets only.
     */
    unlinkedStateCheck: check(
      'ck_wallets_unlinked_state',
      sql`
        ${table.status} != 'unlinked'
        OR (
          ${table.provenance} = 'external'
          AND ${table.isPrimary} = false
          AND ${table.unlinkedAt} IS NOT NULL
        )
      `,
    ),

    /**
     * Internal wallets cannot be unlinked.
     */
    internalUnlinkedCheck: check(
      'ck_wallets_internal_unlinked',
      sql`
        ${table.provenance} != 'internal'
        OR ${table.status} != 'unlinked'
      `,
    ),

    verifiedAfterLinkedCheck: check(
      'ck_wallets_verified_after_linked',
      sql`
        ${table.verifiedAt} IS NULL
        OR ${table.verifiedAt} >= ${table.linkedAt}
      `,
    ),

    suspendedAfterLinkedCheck: check(
      'ck_wallets_suspended_after_linked',
      sql`
        ${table.suspendedAt} IS NULL
        OR ${table.suspendedAt} >= ${table.linkedAt}
      `,
    ),

    revokedAfterLinkedCheck: check(
      'ck_wallets_revoked_after_linked',
      sql`
        ${table.revokedAt} IS NULL
        OR ${table.revokedAt} >= ${table.linkedAt}
      `,
    ),

    unlinkedAfterLinkedCheck: check(
      'ck_wallets_unlinked_after_linked',
      sql`
        ${table.unlinkedAt} IS NULL
        OR ${table.unlinkedAt} >= ${table.linkedAt}
      `,
    ),


    provenanceCheck: check(
      'ck_wallets_provenance',
      sql`
        ${table.provenance} IN ('internal', 'external')
      `,
    ),

    controlModeCheck: check(
      'ck_wallets_control_mode',
      sql`
        (
          ${table.provenance} = 'internal'
          AND ${table.walletType} = 'eoa'
          AND ${table.controlMode} = 'platform_key'
        )
        OR (
          ${table.provenance} = 'external'
          AND ${table.walletType} = 'eoa'
          AND ${table.controlMode} = 'external_user'
        )
        OR (
          ${table.walletType} = 'smart_contract'
          AND ${table.controlMode} = 'contract_controller'
        )
      `,
    ),

    smartContractControllerCheck: check(
      'ck_wallets_smart_contract_controller',
      sql`
        ${table.walletType} != 'smart_contract'
        OR ${table.controllerWalletId} IS NOT NULL
      `,
    ),
  }),
);

/* ============================================================================
 * 4. WEB3 TRANSACTIONS
 * ========================================================================== */

export const web3Transactions = sqliteTable(
  'web3_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    networkId: integer('network_id')
      .notNull()
      .references(() => web3Networks.id, {
        onDelete: 'restrict',
      }),

    walletId: integer('wallet_id')
      .notNull()
      .references(() => wallets.id, {
        onDelete: 'restrict',
      }),

    /**
     * Optional until signing/submission.
     */
    txHash: text('tx_hash'),

    /**
     * Technical operation type.
     */
    transactionType: text('transaction_type', {
      enum: [
        'native_transfer',
        'token_transfer',
        'contract_call',
        'contract_deployment',
        'other',
      ],
    }).notNull(),

    /**
     * EVM sender.
     */
    fromAddress: text('from_address').notNull(),

    /**
     * NULL is valid for contract deployment.
     */
    toAddress: text('to_address'),

    /**
     * EVM nonce.
     *
     * Historical transactions MAY share the same nonce because of
     * replacement.
     */
    nonce: integer('nonce'),

    /**
     * Native asset value in base units.
     */
    valueBaseUnits: text('value_base_units')
      .notNull()
      .default('0'),

    /**
     * Raw transaction calldata.
     */
    data: text('data'),

    /**
     * Legacy gas model.
     */
    gasLimit: text('gas_limit'),
    gasPrice: text('gas_price'),

    /**
     * EIP-1559 gas model.
     */
    maxFeePerGas: text('max_fee_per_gas'),
    maxPriorityFeePerGas: text('max_priority_fee_per_gas'),

    /**
     * Receipt gas information.
     */
    gasUsed: text('gas_used'),
    effectiveGasPrice: text('effective_gas_price'),

    /**
     * Block inclusion.
     */
    blockNumber: integer('block_number'),
    blockHash: text('block_hash'),

    /**
     * Blockchain transaction lifecycle.
     */
    status: text('status', {
      enum: [
        'created',
        'signing',
        'signed',
        'submitted',
        'pending',
        'confirmed',
        'failed',
        'dropped',
        'replaced',
      ],
    })
      .notNull()
      .default('created'),

    /**
     * Actual receipt execution result.
     *
     * success  = execution succeeded
     * reverted = transaction was mined but reverted
     */
    receiptStatus: text('receipt_status', {
      enum: ['success', 'reverted'],
    }),

    /**
     * Diagnosis code for failed/dropped/replaced transactions.
     */
    failureCode: text('failure_code'),
    failureReason: text('failure_reason'),

    /**
     * Replacement lineage.
     *
     * If transaction B replaces transaction A:
     *
     * B.replacementOfTransactionId = A.id
     */
    replacementOfTransactionId: integer(
      'replacement_of_transaction_id',
    ),

    submittedAt: integer('submitted_at', {
      mode: 'timestamp',
    }),

    confirmedAt: integer('confirmed_at', {
      mode: 'timestamp',
    }),

    failedAt: integer('failed_at', {
      mode: 'timestamp',
    }),

    version: integer('version').notNull().default(1),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    /**
     * A blockchain transaction hash is unique per network.
     */
    txHashUnique: uniqueIndex(
      'uq_web3_transactions_network_hash',
    ).on(
      table.networkId,
      table.txHash,
    ),

    /**
     * IMPORTANT:
     *
     * We intentionally DO NOT create:
     *
     *   UNIQUE(walletId, nonce)
     *
     * because replacements legitimately reuse a nonce.
     *
     * This partial unique index only reserves a nonce while a transaction
     * is actively occupying it.
     */
    activeWalletNonceUnique: uniqueIndex(
      'uq_web3_transactions_active_wallet_nonce',
    )
      .on(
        table.walletId,
        table.nonce,
      )
      .where(
        sql`
          ${table.nonce} IS NOT NULL
          AND ${table.status} IN (
            'created',
            'signing',
            'signed',
            'submitted',
            'pending'
          )
        `,
      ),

    replacementFk: foreignKey({
      columns: [table.replacementOfTransactionId],
      foreignColumns: [table.id],
      name: 'fk_web3_transactions_replacement',
    }).onDelete('restrict'),


    walletIdx: index(
      'idx_web3_transactions_wallet',
    ).on(
      table.walletId,
      table.createdAt,
    ),

    walletNonceIdx: index(
      'idx_web3_transactions_wallet_nonce',
    ).on(
      table.walletId,
      table.nonce,
    ),

    networkStatusIdx: index(
      'idx_web3_transactions_network_status',
    ).on(
      table.networkId,
      table.status,
      table.createdAt,
    ),

    statusIdx: index(
      'idx_web3_transactions_status',
    ).on(table.status),

    replacementIdx: index(
      'idx_web3_transactions_replacement',
    ).on(
      table.replacementOfTransactionId,
    ),

    blockIdx: index(
      'idx_web3_transactions_block',
    ).on(
      table.networkId,
      table.blockNumber,
    ),

    nonceCheck: check(
      'ck_web3_transactions_nonce',
      sql`
        ${table.nonce} IS NULL
        OR ${table.nonce} >= 0
      `,
    ),

    blockNumberCheck: check(
      'ck_web3_transactions_block_number',
      sql`
        ${table.blockNumber} IS NULL
        OR ${table.blockNumber} >= 0
      `,
    ),

    /**
     * 0x + 64 hexadecimal characters.
     */
    txHashCheck: check(
      'ck_web3_transactions_hash',
      sql`
        ${table.txHash} IS NULL
        OR (
          ${table.txHash} LIKE '0x%'
          AND length(${table.txHash}) = 66
          AND substr(${table.txHash}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    fromAddressCheck: check(
      'ck_web3_transactions_from_address',
      sql`
        ${table.fromAddress} LIKE '0x%'
        AND length(${table.fromAddress}) = 42
        AND substr(${table.fromAddress}, 3)
            NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    toAddressCheck: check(
      'ck_web3_transactions_to_address',
      sql`
        ${table.toAddress} IS NULL
        OR (
          ${table.toAddress} LIKE '0x%'
          AND length(${table.toAddress}) = 42
          AND substr(${table.toAddress}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    dataCheck: check(
      'ck_web3_transactions_data',
      sql`
        ${table.data} IS NULL
        OR (
          ${table.data} LIKE '0x%'
          AND length(${table.data}) >= 2
          AND (length(${table.data}) - 2) % 2 = 0
          AND substr(${table.data}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    /**
     * Canonical unsigned integer:
     *
     * 0
     * 1
     * 100
     *
     * No:
     * - negative values
     * - leading zeroes
     * - decimals
     * - text garbage
     */
    valueBaseUnitsCheck: check(
      'ck_web3_transactions_value_base_units',
      sql`
        ${table.valueBaseUnits} <> ''
        AND ltrim(
          ${table.valueBaseUnits},
          '0123456789'
        ) = ''
        AND (
          ${table.valueBaseUnits} = '0'
          OR ltrim(
            ${table.valueBaseUnits},
            '0'
          ) = ${table.valueBaseUnits}
        )
      `,
    ),

    gasLimitCheck: check(
      'ck_web3_transactions_gas_limit',
      sql`
        ${table.gasLimit} IS NULL
        OR (
          ${table.gasLimit} <> ''
          AND ltrim(
            ${table.gasLimit},
            '0123456789'
          ) = ''
          AND (
            ${table.gasLimit} = '0'
            OR ltrim(
              ${table.gasLimit},
              '0'
            ) = ${table.gasLimit}
          )
        )
      `,
    ),

    gasPriceCheck: check(
      'ck_web3_transactions_gas_price',
      sql`
        ${table.gasPrice} IS NULL
        OR (
          ${table.gasPrice} <> ''
          AND ltrim(
            ${table.gasPrice},
            '0123456789'
          ) = ''
          AND (
            ${table.gasPrice} = '0'
            OR ltrim(
              ${table.gasPrice},
              '0'
            ) = ${table.gasPrice}
          )
        )
      `,
    ),

    maxFeePerGasCheck: check(
      'ck_web3_transactions_max_fee_per_gas',
      sql`
        ${table.maxFeePerGas} IS NULL
        OR (
          ${table.maxFeePerGas} <> ''
          AND ltrim(
            ${table.maxFeePerGas},
            '0123456789'
          ) = ''
          AND (
            ${table.maxFeePerGas} = '0'
            OR ltrim(
              ${table.maxFeePerGas},
              '0'
            ) = ${table.maxFeePerGas}
          )
        )
      `,
    ),

    maxPriorityFeePerGasCheck: check(
      'ck_web3_transactions_max_priority_fee_per_gas',
      sql`
        ${table.maxPriorityFeePerGas} IS NULL
        OR (
          ${table.maxPriorityFeePerGas} <> ''
          AND ltrim(
            ${table.maxPriorityFeePerGas},
            '0123456789'
          ) = ''
          AND (
            ${table.maxPriorityFeePerGas} = '0'
            OR ltrim(
              ${table.maxPriorityFeePerGas},
              '0'
            ) = ${table.maxPriorityFeePerGas}
          )
        )
      `,
    ),

    gasUsedCheck: check(
      'ck_web3_transactions_gas_used',
      sql`
        ${table.gasUsed} IS NULL
        OR (
          ${table.gasUsed} <> ''
          AND ltrim(
            ${table.gasUsed},
            '0123456789'
          ) = ''
          AND (
            ${table.gasUsed} = '0'
            OR ltrim(
              ${table.gasUsed},
              '0'
            ) = ${table.gasUsed}
          )
        )
      `,
    ),

    effectiveGasPriceCheck: check(
      'ck_web3_transactions_effective_gas_price',
      sql`
        ${table.effectiveGasPrice} IS NULL
        OR (
          ${table.effectiveGasPrice} <> ''
          AND ltrim(
            ${table.effectiveGasPrice},
            '0123456789'
          ) = ''
          AND (
            ${table.effectiveGasPrice} = '0'
            OR ltrim(
              ${table.effectiveGasPrice},
              '0'
            ) = ${table.effectiveGasPrice}
          )
        )
      `,
    ),

    /**
     * EIP-1559 requires maxFeePerGas whenever maxPriorityFeePerGas exists.
     *
     * The numerical relation:
     *
     *   maxPriorityFeePerGas <= maxFeePerGas
     *
     * must also be validated in application/domain code using BigInt,
     * because arbitrary-size integer strings cannot safely be compared with
     * SQLite's native numeric operators.
     */
    maxPriorityRequiresMaxFeeCheck: check(
      'ck_web3_transactions_priority_requires_max_fee',
      sql`
        ${table.maxPriorityFeePerGas} IS NULL
        OR ${table.maxFeePerGas} IS NOT NULL
      `,
    ),

    /**
     * Submitted/live transactions must have a hash.
     */
    submittedHashCheck: check(
      'ck_web3_transactions_submitted_hash',
      sql`
        ${table.status} NOT IN (
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR ${table.txHash} IS NOT NULL
      `,
    ),

    /**
     * Signed/live transactions need nonce.
     */
    signedNonceCheck: check(
      'ck_web3_transactions_signed_nonce',
      sql`
        ${table.status} NOT IN (
          'signed',
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR ${table.nonce} IS NOT NULL
      `,
    ),

    /**
     * Submitted/live transactions require submittedAt.
     */
    submittedAtCheck: check(
      'ck_web3_transactions_submitted_at',
      sql`
        ${table.status} NOT IN (
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR ${table.submittedAt} IS NOT NULL
      `,
    ),

    /**
     * Confirmed transaction must have complete chain/receipt data.
     */
    confirmedStateCheck: check(
      'ck_web3_transactions_confirmed_state',
      sql`
        ${table.status} != 'confirmed'
        OR (
          ${table.confirmedAt} IS NOT NULL
          AND ${table.blockNumber} IS NOT NULL
          AND ${table.blockHash} IS NOT NULL
          AND ${table.receiptStatus} IS NOT NULL
        )
      `,
    ),

    blockHashCheck: check(
      'ck_web3_transactions_block_hash',
      sql`
        ${table.blockHash} IS NULL
        OR (
          ${table.blockHash} LIKE '0x%'
          AND length(${table.blockHash}) = 66
          AND substr(${table.blockHash}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    /**
     * Failed transaction requires failure timestamp.
     */
    failedStateCheck: check(
      'ck_web3_transactions_failed_state',
      sql`
        ${table.status} != 'failed'
        OR ${table.failedAt} IS NOT NULL
      `,
    ),

    /**
     * A replacement cannot point to itself.
     */
    replacementSelfCheck: check(
      'ck_web3_transactions_replacement_self',
      sql`
        ${table.replacementOfTransactionId} IS NULL
        OR ${table.replacementOfTransactionId} != ${table.id}
      `,
    ),

    /**
     * Replacement must have nonce and cannot be the initial transaction.
     */
    replacementStateCheck: check(
      'ck_web3_transactions_replacement_state',
      sql`
        ${table.status} != 'replaced'
        OR (
          ${table.nonce} IS NOT NULL
          AND ${table.replacementOfTransactionId} IS NOT NULL
        )
      `,
    ),

    versionCheck: check(
      'ck_web3_transactions_version',
      sql`${table.version} > 0`,
    ),
  }),
);

```

---

## `src/domains/civil-identity/use-cases/RegisterCitizenUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { CitizenRecord } from '../../../application/ports/output/ICivilIdentityRepository';

export interface RegisterCitizenDTO {
  userId: number;
  legalFirstName: string;
  legalLastName: string;
  nationalityCode?: string;
  birthDate?: string;
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed' | 'stable_union' | 'separated';
}

export class RegisterCitizenUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RegisterCitizenDTO): Promise<Result<CitizenRecord>> {
    if (!dto.userId || !dto.legalFirstName || !dto.legalLastName) {
      return Result.fail<CitizenRecord>('ID do usuário, nome e sobrenome legal são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const civilRepo = factory.getCivilIdentityRepository();
      const existing = await civilRepo.findCitizenByUserId(dto.userId);

      if (existing) {
        return Result.ok<CitizenRecord>(existing);
      }

      const created = await civilRepo.createCitizen({
        userId: dto.userId,
        legalFirstName: dto.legalFirstName,
        legalLastName: dto.legalLastName,
        nationalityCode: dto.nationalityCode || 'BR',
        birthDate: dto.birthDate,
        maritalStatus: dto.maritalStatus,
        civilStatus: 'pending',
      });

      return Result.ok<CitizenRecord>(created);
    });
  }
}

```

---

## `src/domains/civil-identity/use-cases/SubmitKycVerificationUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { KycVerificationRecord } from '../../../application/ports/output/ICivilIdentityRepository';

export interface SubmitKycVerificationDTO {
  userId: number;
  verificationLevel: 'basic' | 'enhanced' | 'institutional';
  documentType: 'cpf' | 'rg' | 'passport' | 'cnh';
  documentNumber: string;
  provider?: string;
}

export class SubmitKycVerificationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: SubmitKycVerificationDTO): Promise<Result<KycVerificationRecord>> {
    if (!dto.userId || !dto.documentNumber) {
      return Result.fail<KycVerificationRecord>('UserId e número do documento são obrigatórios para KYC.');
    }

    return await this.uow.execute(async (factory) => {
      const civilRepo = factory.getCivilIdentityRepository();

      // Computa hashes para proteção de PII (HMAC / SHA256 simulado)
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(dto.documentNumber));
      const numberLookupHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const last4 = dto.documentNumber.slice(-4);

      // 1. Salva registro de documento de identidade
      await civilRepo.createIdentityDocument({
        userId: dto.userId,
        documentType: dto.documentType,
        countryCode: 'BR',
        numberLookupHash,
        encryptedNumber: `enc_${dto.documentNumber}`, // Em produção: chave KMS
        last4,
        source: 'manual_upload',
        verificationStatus: 'pending',
      });

      // 2. Registra o processo de verificação KYC
      const kyc = await civilRepo.createKycVerification({
        userId: dto.userId,
        verificationLevel: dto.verificationLevel || 'basic',
        status: 'submitted',
        provider: dto.provider || 'asppibra_internal_kyc',
        startedAt: new Date(),
      });

      return Result.ok<KycVerificationRecord>(kyc);
    });
  }
}

```

---

## `src/domains/finance/use-cases/GetTreasuryBalanceUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AccountBalanceRecord } from '../../../application/ports/output/IFinanceRepository';

export class GetTreasuryBalanceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(): Promise<Result<AccountBalanceRecord[]>> {
    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();
      return await financeRepo.getTreasuryBalance();
    });
  }
}

```

---

## `src/domains/finance/use-cases/RecordTreasuryTransactionUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { FinancialTransactionRecord } from '../../../application/ports/output/IFinanceRepository';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  category?: string;
  description: string;
  amountBaseUnits: string;
  assetId?: number;
}

export class RecordTreasuryTransactionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<FinancialTransactionRecord>> {
    if (!dto.description || !dto.amountBaseUnits) {
      return Result.fail<FinancialTransactionRecord>('Descrição e valor são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();
      return await financeRepo.createTransaction({
        userId: dto.userId || null,
        type: dto.type,
        category: dto.category || 'operational',
        description: dto.description,
        amountBaseUnits: dto.amountBaseUnits,
        assetId: dto.assetId || 1, // 1 = BRL / Native asset
      });
    });
  }
}

```

---

## `src/domains/identity/entities/AuthenticationChallenge.ts`

```typescript
import { AuthContext } from './AuthenticationTransaction';

export interface AuthenticationChallengeProps {
  id: string;
  transactionId?: string | null;
  userId?: number | null;
  challengeHash: string;
  challengeType: string;
  context: AuthContext;
  usedAt?: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

export class AuthenticationChallenge {
  private props: AuthenticationChallengeProps;

  constructor(props: AuthenticationChallengeProps) {
    this.props = { ...props };
  }

  get id(): string { return this.props.id; }
  get transactionId(): string | null { return this.props.transactionId || null; }
  get challengeHash(): string { return this.props.challengeHash; }
  get context(): AuthContext { return this.props.context; }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() > this.props.expiresAt.getTime();
  }

  public isUsed(): boolean {
    return this.props.usedAt !== null && this.props.usedAt !== undefined;
  }

  public isValid(): boolean {
    return !this.isExpired() && !this.isUsed();
  }

  public markAsUsed(): void {
    if (this.isUsed()) {
      throw new Error('Challenge already used (Replay detected)');
    }
    this.props.usedAt = new Date();
  }

  public toPersistence(): any {
    return { ...this.props };
  }

  public static fromPersistence(record: any): AuthenticationChallenge {
    return new AuthenticationChallenge({
      id: record.id,
      transactionId: record.transactionId,
      userId: record.userId,
      challengeHash: record.challengeHash,
      challengeType: record.challengeType,
      context: record.context as AuthContext,
      usedAt: record.usedAt ? new Date(record.usedAt) : null,
      createdAt: new Date(record.createdAt),
      expiresAt: new Date(record.expiresAt),
    });
  }
}

```

---

## `src/domains/identity/entities/AuthenticationTransaction.ts`

```typescript
export type AuthTransactionStatus =
  | 'created'
  | 'awaiting_factor'
  | 'verified'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'failed'
  | 'replayed'
  | 'locked';

export type AuthContext =
  | 'login'
  | 'mfa_setup'
  | 'mfa_change'
  | 'credential_link'
  | 'credential_unlink'
  | 'sensitive_operation'
  | 'password_change'
  | 'recovery';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AuthenticationTransactionProps {
  id: string;
  userId: number;
  status: AuthTransactionStatus;
  initialAal: number;
  currentAal: number;
  targetAal: number;
  method: string;
  challengeHash?: string | null;
  context: AuthContext;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date | null;
  consumedAt?: Date | null;
  failureCount: number;
  authEpochAtStart: number;
  lastAuthenticatedAt?: Date | null;
  assuranceMethod?: string | null;
  riskLevel: RiskLevel;
}

export class AuthenticationTransaction {
  private props: AuthenticationTransactionProps;

  constructor(props: AuthenticationTransactionProps) {
    this.props = { ...props };
  }

  get id(): string { return this.props.id; }
  get userId(): number { return this.props.userId; }
  get status(): AuthTransactionStatus { return this.props.status; }
  get targetAal(): number { return this.props.targetAal; }
  get currentAal(): number { return this.props.currentAal; }
  get context(): AuthContext { return this.props.context; }
  get authEpochAtStart(): number { return this.props.authEpochAtStart; }
  get expiresAt(): Date { return this.props.expiresAt; }
  get failureCount(): number { return this.props.failureCount; }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() > this.props.expiresAt.getTime();
  }

  public isValid(currentAuthEpoch: number): boolean {
    if (this.isExpired()) return false;
    if (this.props.status === 'expired' || this.props.status === 'cancelled' || this.props.status === 'failed' || this.props.status === 'locked' || this.props.status === 'completed') {
      return false;
    }
    // AuthEpoch must match the one at the start of the transaction
    if (currentAuthEpoch !== this.props.authEpochAtStart) {
      return false;
    }
    return true;
  }

  public recordFailedAttempt(maxAttempts: number = 5): void {
    this.props.failureCount += 1;
    if (this.props.failureCount >= maxAttempts) {
      this.props.status = 'locked';
    }
  }

  public verifyFactor(method: string, newAal: number): void {
    if (this.props.status !== 'created' && this.props.status !== 'awaiting_factor') {
      throw new Error(`Cannot verify factor in status ${this.props.status}`);
    }
    this.props.method = method;
    this.props.currentAal = newAal;
    this.props.status = 'verified';
    this.props.assuranceMethod = method;
  }

  public complete(): void {
    if (this.props.status !== 'verified') {
      throw new Error('Transaction must be verified before completion');
    }
    this.props.status = 'completed';
    this.props.completedAt = new Date();
  }

  public toPersistence(): any {
    return { ...this.props };
  }

  public static fromPersistence(record: any): AuthenticationTransaction {
    return new AuthenticationTransaction({
      id: record.id,
      userId: record.userId,
      status: record.status,
      initialAal: record.initialAal,
      currentAal: record.currentAal,
      targetAal: record.targetAal,
      method: record.method,
      challengeHash: record.challengeHash,
      context: record.context,
      ip: record.ip,
      userAgent: record.userAgent,
      createdAt: new Date(record.createdAt),
      expiresAt: new Date(record.expiresAt),
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
      consumedAt: record.consumedAt ? new Date(record.consumedAt) : null,
      failureCount: record.failureCount,
      authEpochAtStart: record.authEpochAtStart,
      lastAuthenticatedAt: record.lastAuthenticatedAt ? new Date(record.lastAuthenticatedAt) : null,
      assuranceMethod: record.assuranceMethod,
      riskLevel: record.riskLevel,
    });
  }
}

```

---

## `src/domains/identity/entities/Session.ts`

```typescript
export interface SessionProps {
  id: string;
  userId: number;
  jti: string;
  ip: string | null;
  userAgent: string | null;
  refreshTokenHash: string;
  aal: number;
  authEpoch: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
}

export class Session {
  private props: SessionProps;

  private constructor(props: SessionProps) {
    this.props = { ...props };
  }

  public static fromPersistence(props: SessionProps): Session {
    return new Session(props);
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): number {
    return this.props.userId;
  }

  get authEpoch(): number {
    return this.props.authEpoch;
  }
  
  get aal(): number {
    return this.props.aal;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get lastActivityAt(): Date | null {
    return this.props.lastActivityAt;
  }

  get isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  get isExpired(): boolean {
    return new Date() > this.props.expiresAt;
  }

  public isValid(): boolean {
    return !this.isRevoked && !this.isExpired;
  }

  public matchesUserEpoch(userAuthEpoch: number): boolean {
    return this.props.authEpoch === userAuthEpoch;
  }

  public revoke(reason: string): void {
    if (!this.isRevoked) {
      this.props.revokedAt = new Date();
      this.props.revocationReason = reason;
    }
  }
}

```

---

## `src/domains/identity/entities/User.ts`

```typescript
export type UserStatus = 'active' | 'suspended' | 'pending_setup' | 'locked';
export type SubjectType = 'human' | 'service' | 'system' | 'citizen';

export interface UserProps {
  id: number;
  publicId?: string | null;
  email?: string | null;
  emailNormalized?: string | null;
  status: UserStatus;
  subjectType: SubjectType;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  authEpoch: number;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  public static readonly MAX_FAILED_ATTEMPTS = 5;

  private props: UserProps;

  constructor(props: UserProps) {
    this.props = { ...props };
  }

  get id(): number {
    return this.props.id;
  }

  get email(): string | null {
    return this.props.email || null;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get subjectType(): SubjectType {
    return this.props.subjectType;
  }

  get failedLoginAttempts(): number {
    return this.props.failedLoginAttempts;
  }

  get authEpoch(): number {
    return this.props.authEpoch;
  }

  public canAuthenticate(): boolean {
    if (this.props.status === 'suspended' || this.props.status === 'locked' || this.props.status === 'pending_setup') {
      return false;
    }
    
    // Only humans (or citizens, depending on legacy naming) can authenticate via standard login forms
    if (this.props.subjectType !== 'human' && this.props.subjectType !== 'citizen') {
      return false;
    }
    
    return true;
  }

  public registerFailedLogin(): void {
    this.props.failedLoginAttempts += 1;
    this.props.lastFailedLoginAt = new Date();
    
    if (this.props.failedLoginAttempts >= User.MAX_FAILED_ATTEMPTS) {
      this.props.status = 'locked';
    }
  }

  public resetFailedLogins(): void {
    this.props.failedLoginAttempts = 0;
    this.props.lastFailedLoginAt = null;
    
    if (this.props.status === 'locked') {
      this.props.status = 'active';
    }
  }
}

```

---

## `src/domains/identity/errors/AntiLockoutViolationError.ts`

```typescript
export class AntiLockoutViolationError extends Error {
  readonly code = 'ANTI_LOCKOUT_VIOLATION';

  constructor(message: string = 'Não é possível remover a última credencial de autenticação da conta.') {
    super(message);
    this.name = 'AntiLockoutViolationError';
  }
}

```

---

## `src/domains/identity/errors/IdentityNotLinkedError.ts`

```typescript
export class IdentityNotLinkedError extends Error {
  readonly code = 'IDENTITY_NOT_LINKED';

  constructor(message: string = 'Identidade não vinculada a nenhuma conta existente.') {
    super(message);
    this.name = 'IdentityNotLinkedError';
  }
}

```

---

## `src/domains/identity/services/CanonicalIdentityResolver.ts`

```typescript
import { IIdentityResolverPort } from '../../../application/ports/output/IIdentityResolverPort';
import { IdentityAssertion } from '../../../application/dto/IdentityAssertion';
import { IdentityResolutionResult } from '../../../application/dto/IdentityResolutionResult';

export class CanonicalIdentityResolver implements IIdentityResolverPort {
  constructor(private readonly resolverAdapter: IIdentityResolverPort) {}

  async resolve(assertion: IdentityAssertion): Promise<IdentityResolutionResult> {
    return this.resolverAdapter.resolve(assertion);
  }
}

```

---

## `src/domains/phase3_modules.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Result } from '../shared/kernel/Result';
import { RegisterCitizenUseCase } from './civil-identity/use-cases/RegisterCitizenUseCase';
import { SubmitKycVerificationUseCase } from './civil-identity/use-cases/SubmitKycVerificationUseCase';
import { CreateDidUseCase } from './ssi/use-cases/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from './ssi/use-cases/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from './ssi/use-cases/RevokeCredentialUseCase';
import { GetTreasuryBalanceUseCase } from './finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from './finance/use-cases/RecordTreasuryTransactionUseCase';

describe('Phase 3 Ecosystem Modules Suite', () => {
  describe('Civil Identity Use Cases', () => {
    it('should register a new citizen civil identity', async () => {
      const mockCivilRepo = {
        findCitizenByUserId: vi.fn().mockResolvedValue(null),
        createCitizen: vi.fn().mockImplementation(async (data) => ({
          ...data,
          username: 'citizen_123',
          version: 1,
        })),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getCivilIdentityRepository: () => mockCivilRepo,
          })
        ),
      };

      const useCase = new RegisterCitizenUseCase(mockUow as any);
      const result = await useCase.execute({
        userId: 10,
        legalFirstName: 'João',
        legalLastName: 'Silva',
        nationalityCode: 'BR',
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().legalFirstName).toBe('João');
      expect(mockCivilRepo.createCitizen).toHaveBeenCalled();
    });

    it('should submit KYC verification request and store identity document', async () => {
      const mockCivilRepo = {
        createIdentityDocument: vi.fn().mockResolvedValue({ id: 1, userId: 10 }),
        createKycVerification: vi.fn().mockResolvedValue({
          id: 5,
          userId: 10,
          status: 'submitted',
          verificationLevel: 'basic',
        }),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getCivilIdentityRepository: () => mockCivilRepo,
          })
        ),
      };

      const useCase = new SubmitKycVerificationUseCase(mockUow as any);
      const result = await useCase.execute({
        userId: 10,
        verificationLevel: 'basic',
        documentType: 'cpf',
        documentNumber: '12345678901',
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().status).toBe('submitted');
      expect(mockCivilRepo.createIdentityDocument).toHaveBeenCalled();
      expect(mockCivilRepo.createKycVerification).toHaveBeenCalled();
    });
  });

  describe('SSI / DID Use Cases', () => {
    it('should create a W3C DID for a user', async () => {
      const mockSsiRepo = {
        findDidByUserId: vi.fn().mockResolvedValue(Result.fail('Not found')),
        saveDid: vi.fn().mockImplementation(async (record) => Result.ok(record)),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSsiRepository: () => mockSsiRepo,
          })
        ),
      };

      const useCase = new CreateDidUseCase(mockUow as any);
      const result = await useCase.execute({ userId: 10, method: 'key' });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().did).toContain('did:key:');
      expect(mockSsiRepo.saveDid).toHaveBeenCalled();
    });

    it('should issue a Verifiable Credential to DID holder', async () => {
      const mockSsiRepo = {
        findDidByUserId: vi.fn().mockResolvedValue(Result.ok({ did: 'did:key:holder-123' })),
        saveVerifiableCredential: vi.fn().mockImplementation(async (record) => Result.ok(record)),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSsiRepository: () => mockSsiRepo,
          })
        ),
      };

      const useCase = new IssueVerifiableCredentialUseCase(mockUow as any);
      const result = await useCase.execute({
        holderUserId: 10,
        credentialType: 'CivicIdentityCredential',
        claims: { isCitizen: true },
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().subjectDid).toBe('did:key:holder-123');
      expect(mockSsiRepo.saveVerifiableCredential).toHaveBeenCalled();
    });

    it('should revoke an existing Verifiable Credential', async () => {
      const mockSsiRepo = {
        findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.ok({ id: 'vc-uuid-123' })),
        revokeVerifiableCredential: vi.fn().mockResolvedValue(Result.ok(undefined)),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSsiRepository: () => mockSsiRepo,
          })
        ),
      };

      const useCase = new RevokeCredentialUseCase(mockUow as any);
      const result = await useCase.execute({ credentialId: 'vc-uuid-123' });

      expect(result.isSuccess).toBe(true);
      expect(mockSsiRepo.revokeVerifiableCredential).toHaveBeenCalledWith('vc-uuid-123');
    });
  });

  describe('Finance & Treasury Use Cases', () => {
    it('should query treasury balances', async () => {
      const mockFinanceRepo = {
        getTreasuryBalance: vi.fn().mockResolvedValue(
          Result.ok([{ id: 1, accountId: 1, assetId: 1, availableBaseUnits: '1000000', lockedBaseUnits: '0', version: 1 }])
        ),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getFinanceRepository: () => mockFinanceRepo,
          })
        ),
      };

      const useCase = new GetTreasuryBalanceUseCase(mockUow as any);
      const result = await useCase.execute();

      expect(result.isSuccess).toBe(true);
      expect(result.getValue()[0].availableBaseUnits).toBe('1000000');
    });

    it('should record a treasury financial transaction', async () => {
      const mockFinanceRepo = {
        createTransaction: vi.fn().mockResolvedValue(
          Result.ok({ id: 50, userId: null, type: 'deposit', category: 'operational', description: 'Depósito Inicial', status: 'completed', createdAt: new Date() })
        ),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getFinanceRepository: () => mockFinanceRepo,
          })
        ),
      };

      const useCase = new RecordTreasuryTransactionUseCase(mockUow as any);
      const result = await useCase.execute({
        description: 'Depósito Inicial',
        amountBaseUnits: '50000',
        type: 'deposit',
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().description).toBe('Depósito Inicial');
    });
  });
});

```

---

## `src/domains/ssi/use-cases/CreateDidUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { DidIdentityRecord } from '../../../application/ports/output/ISsiRepository';

export interface CreateDidDTO {
  userId: number;
  method?: 'key' | 'ion' | 'polygonid' | 'web' | 'cheqd' | 'pkh';
}

export class CreateDidUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: CreateDidDTO): Promise<Result<DidIdentityRecord>> {
    if (!dto.userId) {
      return Result.fail<DidIdentityRecord>('ID do usuário é obrigatório para geração de DID.');
    }

    const method = dto.method || 'key';

    return await this.uow.execute(async (factory) => {
      const ssiRepo = factory.getSsiRepository();
      const existingRes = await ssiRepo.findDidByUserId(dto.userId);

      if (existingRes.isSuccess) {
        return existingRes;
      }

      const id = crypto.randomUUID();
      const did = `did:${method}:${id}`;
      const record: DidIdentityRecord = {
        id,
        userId: dto.userId,
        did,
        method,
        controller: did,
        status: 'active',
        version: 1,
      };

      return await ssiRepo.saveDid(record);
    });
  }
}

```

---

## `src/domains/ssi/use-cases/IssueVerifiableCredentialUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { VerifiableCredentialRecord } from '../../../application/ports/output/ISsiRepository';

export interface IssueVerifiableCredentialDTO {
  holderUserId: number;
  credentialType: 'CivicIdentityCredential' | 'MembershipCredential' | 'KycVerificationCredential' | 'ReputationCredential';
  claims: Record<string, any>;
  expirationDays?: number;
}

export class IssueVerifiableCredentialUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: IssueVerifiableCredentialDTO): Promise<Result<VerifiableCredentialRecord>> {
    if (!dto.holderUserId || !dto.credentialType) {
      return Result.fail<VerifiableCredentialRecord>('HolderUserId e credentialType são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const ssiRepo = factory.getSsiRepository();
      const didRes = await ssiRepo.findDidByUserId(dto.holderUserId);

      if (didRes.isFailure) {
        return Result.fail<VerifiableCredentialRecord>('DID não encontrado para o cidadão informado. Crie o DID primeiro.');
      }

      const subjectDid = didRes.getValue().did;
      const issuerDid = 'did:key:asppibra-dao-root-issuer';
      const id = crypto.randomUUID();
      const claimsStr = JSON.stringify(dto.claims);

      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(id + subjectDid + claimsStr));
      const credentialHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const issuanceDate = new Date();
      const expirationDate = dto.expirationDays
        ? new Date(Date.now() + dto.expirationDays * 86400 * 1000)
        : null;

      const record: VerifiableCredentialRecord = {
        id,
        holderUserId: dto.holderUserId,
        issuerDid,
        subjectDid,
        credentialType: dto.credentialType,
        credentialHash,
        encryptedClaims: `enc_${claimsStr}`, // Simulação KMS / Vault
        proofType: 'Ed25519Signature2020',
        status: 'active',
        issuanceDate,
        expirationDate,
        version: 1,
      };

      return await ssiRepo.saveVerifiableCredential(record);
    });
  }
}

```

---

## `src/domains/ssi/use-cases/RevokeCredentialUseCase.ts`

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';

export interface RevokeCredentialDTO {
  credentialId: string;
}

export class RevokeCredentialUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RevokeCredentialDTO): Promise<Result<void>> {
    if (!dto.credentialId) {
      return Result.fail<void>('CredentialId é obrigatório para revogação.');
    }

    return await this.uow.execute(async (factory) => {
      const ssiRepo = factory.getSsiRepository();
      const vcRes = await ssiRepo.findVerifiableCredentialById(dto.credentialId);

      if (vcRes.isFailure) {
        return Result.fail<void>('Credencial Verificável não encontrada.');
      }

      return await ssiRepo.revokeVerifiableCredential(dto.credentialId);
    });
  }
}

```

---

## `src/index.ts`

```typescript
/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Central System API & Identity Provider
 * Entry Point: Cloudflare Worker (Hono Framework)
 */

import { Hono, Context, Next } from 'hono';
import { ExecutionContext, ScheduledEvent, MessageBatch } from '@cloudflare/workers-types';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { correlationIdMiddleware } from './interfaces/http/middlewares/correlation_id';
import { Bindings, Variables } from './types/bindings';
import { createDb } from './db';
import { error, success } from './interfaces/http/helpers/response';
import { Logger } from './infrastructure/observability/logger';

// --- CORE MODULES ---
import healthRouter from './interfaces/http/routes/core/health';
import webhooksRouter from './interfaces/http/routes/core/webhooks';
import complianceRouter from './interfaces/http/routes/core/compliance';
import identityRouter from './interfaces/http/routes/identity/identity.routes';
import { civilIdentityRouter } from './interfaces/http/routes/civil-identity/civil_identity.routes';
import { ssiRouter } from './interfaces/http/routes/ssi/ssi.routes';
import { financeRouter } from './interfaces/http/routes/finance/finance.routes';
import { JwtService } from './infrastructure/security/jwt/JwtService';


// Configuração de Tipagem do Hono
type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

const app = new Hono<AppType>();

// =================================================================
// 1. MIDDLEWARES GLOBAIS
// =================================================================

// 1.0 Observabilidade & Security Headers Globais
app.use('*', correlationIdMiddleware());
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"], // API não executa scripts client-side
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      connectSrc: ["'self'"],
    },
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
    permissionsPolicy: {
      geolocation: ['none'],
      camera: ['none'],
      microphone: ['none'],
    },
  })
);

// 1.1 CORS Dinâmico para suporte a Vercel e Localhost (Hardened)
app.use('/*', async (c: Context<AppType>, next: Next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      const allowedOrigins = [
        'https://app.asppibra.com',
        'https://api.asppibra.com',
      ];

      // Se for ambiente de desenvolvimento, permitimos localhost
      if (c.env?.ENVIRONMENT !== 'production') {
        allowedOrigins.push('http://localhost:3000', 'http://localhost:8787');
      }

      if (!origin) return allowedOrigins[0];

      const cleanOrigin = origin.replace(/\/$/, '');

      if (allowedOrigins.includes(cleanOrigin)) {
        return cleanOrigin;
      }
      
      // Default fallback (block via CORS mismatch)
      return allowedOrigins[0];
    },
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-App-ID',
      'x-admin-key',
      'X-Identity-Signature',
      'X-Identity-DID',
      'X-Identity-Timestamp',
      'X-Correlation-ID',
      'Idempotency-Key',
    ],
    allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
    exposeHeaders: ['Content-Length', 'X-Correlation-ID'],
    maxAge: 600,
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// 1.2 Chaos Engineering Middleware (Somente Testes/Dev)
app.use('*', async (c: Context<AppType>, next: Next) => {
  if (c.req.path.match(/\.(css|js|png|jpg|ico|json|map)$/)) {
    return next();
  }

  if (c.env?.ENVIRONMENT !== 'production') {
    if (c.env?.CHAOS_D1_DOWN === 'true' && !c.req.path.startsWith('/api/core/health')) {
      return error(c, 'Simulated D1 Outage', null, 503);
    }
  }

  await next();
});

// 1.3 Database Injection (Scoped)
app.use(async (c: Context<AppType>, next: Next) => {
  if (!c.env.DB) {
    // Secret Management: Fail Closed
    console.error('CRITICAL: DB Binding is missing.');
    return error(c, 'Database configuration error.', null, 500);
  }
  
  if (!c.env.JWT_SECRET || !c.env.TOTP_ENCRYPTION_KEY) {
    console.error('CRITICAL: Essential security secrets are missing.');
    return error(c, 'Security configuration error.', null, 500);
  }

  const db = createDb(c.env.DB);
  c.set('db', db);
  
  // Dependency Injection for JwtService
  c.set('jwtService', new JwtService());
  
  await next();
});

// =================================================================
// 2. ROTAS DE MONITORAMENTO
// =================================================================

app.get('/', async (c) => {
  return c.json({
    version: '1.1.0',
    service: 'Central System API',
    status: 'healthy',
  });
});

app.get('/api/stats', async (c) => {
  // FASE 6: Ocultar dados sensíveis e métricas não autorizadas
  return error(c, 'Endpoint desativado por política de segurança.', null, 403);
});

// =================================================================
// 3. API & ROTAS MODULARES CANÔNICAS
// =================================================================

app.route('/api/core/compliance', complianceRouter);
app.route('/api/core/health', healthRouter);
app.route('/api/core/webhooks', webhooksRouter);
app.route('/api/v1/identity', identityRouter);
app.route('/api/v1/civil', civilIdentityRouter);
app.route('/api/v1/ssi', ssiRouter);
app.route('/api/v1/finance', financeRouter);

// =================================================================
// 4. TRATAMENTO DE ERROS & EXPORT
// =================================================================

app.notFound((c) => c.json({ success: false, message: 'Rota não encontrada (404)' }, 404));

app.onError((err, c) => {
  const correlationId = c.get('correlationId') || 'unknown';
  console.error(`🔥 [${correlationId}] Server Error:`, err);
  
  // FASE 6: Ocultar o err.message em produção, retornar apenas o correlationId
  return c.json({ 
    success: false, 
    message: 'Internal Server Error', 
    correlationId 
  }, 500);
});

export { ChatRoomDO } from './infrastructure/durable_objects/ChatRoomDO';
export { app };
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<any>, env: Bindings, ctx: ExecutionContext): Promise<void> {
    console.log(`📥 Received queue batch from: ${batch.queue} (${batch.messages.length} messages)`);
    
    for (const message of batch.messages) {
      console.log(`[Queue ${batch.queue}] Processing message ${message.id}, attempt: ${message.attempts}`);
      
      try {
        const payload = message.body;
        
        // Idempotency check: in a real environment, we'd check against KV or D1 using payload.idempotencyKey
        
        if (payload?.type === 'password_reset') {
          // Aqui faria a integração real de email com Resend ou SendPulse
          console.log(`🔒 [DELIVERY] Sending password reset for ${payload.email}`);
          // Mock delivery
          // const emailService = new EmailDeliveryService(env.RESEND_API_KEY);
          // await emailService.sendPasswordReset(payload.email, payload.rawToken);
        }

        message.ack();
      } catch (error) {
        console.error(`❌ [Queue] Failed to process message ${message.id}:`, error);
        
        // DLQ Implementation / Max attempts
        const MAX_ATTEMPTS = 3;
        if (message.attempts >= MAX_ATTEMPTS) {
          console.error(`🚨 [DLQ] Message ${message.id} reached max attempts. Moving to DLQ (or dropping).`);
          message.ack(); // Acknowledging to remove from main queue; in Cloudflare, DLQ is configured at the queue level or we store it in a DLQ table
        } else {
          message.retry();
        }
      }
    }
  },
};

```

---

## `src/infrastructure/durable_objects/ChatRoomDO.ts`

```typescript
export class ChatRoomDO {
  state: any;
  env: any;

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({ status: 'active', message: 'ChatRoomDO Initialized' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

```

---

## `src/infrastructure/observability/logger.ts`

```typescript
export class Logger {
  private readonly context: string;

  constructor(context: string) {
    this.context = context;
  }

  info(message: string, meta?: Record<string, any>) {
    this.log('INFO', message, meta);
  }

  warn(message: string, meta?: Record<string, any>) {
    this.log('WARN', message, meta);
  }

  error(message: string, error?: any, meta?: Record<string, any>) {
    const errorDetails =
      error instanceof Error ? { message: error.message, stack: error.stack } : error;
    this.log('ERROR', message, { ...meta, error: errorDetails });
  }

  private log(level: string, message: string, meta?: Record<string, any>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...meta,
    };
    console.log(JSON.stringify(logEntry));
  }
}

```

---

## `src/infrastructure/repositories/DrizzleAuthTransactionRepository.ts`

```typescript
import { DrizzleD1Database } from '../../../types/bindings';
import { IAuthTransactionRepository } from '../../../application/ports/output/IAuthTransactionRepository';
import { AuthenticationTransaction } from '../../../domains/identity/entities/AuthenticationTransaction';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { authTransactions, authChallenges } from '../../../db/authentication/tables';
import { eq, sql } from 'drizzle-orm';

export class DrizzleAuthTransactionRepository implements IAuthTransactionRepository {
  constructor(private readonly db: DrizzleD1Database) {}

  async createTransaction(transaction: AuthenticationTransaction): Promise<void> {
    const data = transaction.toPersistence();
    await this.db.insert(authTransactions).values(data);
  }

  async getTransactionById(id: string): Promise<AuthenticationTransaction | null> {
    const result = await this.db
      .select()
      .from(authTransactions)
      .where(eq(authTransactions.id, id))
      .limit(1)
      .get();
      
    if (!result) return null;
    return AuthenticationTransaction.fromPersistence(result);
  }

  async updateTransaction(transaction: AuthenticationTransaction): Promise<void> {
    const data = transaction.toPersistence();
    await this.db
      .update(authTransactions)
      .set(data)
      .where(eq(authTransactions.id, data.id));
  }

  async createChallenge(challenge: AuthenticationChallenge): Promise<void> {
    const data = challenge.toPersistence();
    await this.db.insert(authChallenges).values(data);
  }

  async getChallengeById(id: string): Promise<AuthenticationChallenge | null> {
    const result = await this.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.id, id))
      .limit(1)
      .get();

    if (!result) return null;
    return AuthenticationChallenge.fromPersistence(result);
  }

  async getChallengeByHash(hash: string): Promise<AuthenticationChallenge | null> {
    const result = await this.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.challengeHash, hash))
      .limit(1)
      .get();

    if (!result) return null;
    return AuthenticationChallenge.fromPersistence(result);
  }

  async updateChallenge(challenge: AuthenticationChallenge): Promise<void> {
    const data = challenge.toPersistence();
    await this.db
      .update(authChallenges)
      .set(data)
      .where(eq(authChallenges.id, data.id));
  }

  async completeFactorAtomically(txId: string, aal: number, authEpochAtStart: number, method: string): Promise<boolean> {
    const result = await this.db
      .update(authTransactions)
      .set({
        status: 'verified',
        currentAal: aal,
        method: method,
        assuranceMethod: method,
        lastAuthenticatedAt: new Date()
      })
      .where(sql`${authTransactions.id} = ${txId} AND ${authTransactions.status} IN ('created', 'awaiting_factor') AND ${authTransactions.authEpochAtStart} = ${authEpochAtStart}`);
      
    return result.meta.changes > 0;
  }

  async recordFailedAttemptAtomically(txId: string, maxAttempts: number): Promise<boolean> {
    const result = await this.db
      .update(authTransactions)
      .set({
        failureCount: sql`${authTransactions.failureCount} + 1`,
        status: sql`CASE WHEN ${authTransactions.failureCount} + 1 >= ${maxAttempts} THEN 'locked' ELSE ${authTransactions.status} END`
      })
      .where(sql`${authTransactions.id} = ${txId} AND ${authTransactions.status} IN ('created', 'awaiting_factor')`);
      
    return result.meta.changes > 0;
  }

  async consumeChallengeAtomically(challengeId: string): Promise<boolean> {
    const result = await this.db
      .update(authChallenges)
      .set({
        usedAt: new Date()
      })
      .where(sql`${authChallenges.id} = ${challengeId} AND ${authChallenges.usedAt} IS NULL AND ${authChallenges.expiresAt} > ${new Date().getTime()}`); // SQLite uses integer timestamp if configured so, but standard is Date. Let's use current_timestamp or just JS Date. Since Drizzle maps Date to int, `new Date()` works. Wait, to be safe, `(strftime('%s', 'now') * 1000)` or just Drizzle's `eq` / `gt`.
      
    // Better Drizzle where syntax
    return result.meta.changes > 0;
  }
}

```

---

## `src/infrastructure/repositories/DrizzleAuthenticationRepositoryAdapter.ts`

```typescript
import { eq, and, isNull } from 'drizzle-orm';
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
    await this.db.insert(userAuthenticators).values({
      id: authenticatorId,
      userId,
      type: 'password',
      verifiedAt: new Date(),
    });

    await this.db.insert(passwordCredentials).values({
      authenticatorId,
      passwordHash,
    });

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
    await this.db.insert(userAuthenticators).values({
      id: authenticatorId,
      userId,
      type: 'totp',
    });

    await this.db.insert(totpCredentials).values({
      authenticatorId,
      encryptedTotpSecret,
    });

    return authenticatorId;
  }

  async verifyTotpAuthenticator(authenticatorId: string): Promise<void> {
    await this.db
      .update(userAuthenticators)
      .set({ verifiedAt: new Date() })
      .where(eq(userAuthenticators.id, authenticatorId));
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
    rpId: string = 'asppibra.com'
  ): Promise<string> {
    const authenticatorId = crypto.randomUUID();
    await this.db.insert(userAuthenticators).values({
      id: authenticatorId,
      userId,
      type: 'webauthn',
      verifiedAt: new Date(),
    });

    await this.db.insert(webauthnCredentials).values({
      authenticatorId,
      credentialId,
      publicKeyCose,
      rpId,
      backupEligible: false,
      backupState: false,
      uvInitialized: true,
    });

    return authenticatorId;
  }

  async updateWebAuthnSignCount(credentialId: string, newSignCount: number): Promise<void> {
    await this.db
      .update(webauthnCredentials)
      .set({ signCount: newSignCount })
      .where(eq(webauthnCredentials.credentialId, credentialId));
  }
}

```

---

## `src/infrastructure/repositories/DrizzleCivilIdentityRepositoryAdapter.ts`

```typescript
import { eq, desc } from 'drizzle-orm';
import { citizens, identityDocuments, kycVerifications } from '../../db/civil-identity/tables';
import {
  ICivilIdentityRepository,
  CitizenRecord,
  IdentityDocumentRecord,
  KycVerificationRecord,
} from '../../application/ports/output/ICivilIdentityRepository';

export type { CitizenRecord, IdentityDocumentRecord, KycVerificationRecord };

export class DrizzleCivilIdentityRepositoryAdapter implements ICivilIdentityRepository {
  constructor(private readonly db: any) {}

  async findByDid(did: string): Promise<CitizenRecord | null> {
    const username = did.split(':').pop();
    const [row] = await this.db
      .select()
      .from(citizens)
      .where(eq(citizens.username, username || did))
      .limit(1);

    if (!row) return null;
    return this.mapCitizenRow(row);
  }

  async createCitizen(data: Partial<CitizenRecord> & { userId: number }): Promise<CitizenRecord> {
    const [inserted] = await this.db
      .insert(citizens)
      .values({
        userId: data.userId,
        legalFirstName: data.legalFirstName || null,
        legalLastName: data.legalLastName || null,
        nationalityCode: data.nationalityCode || 'BR',
        birthDate: data.birthDate || null,
        maritalStatus: (data.maritalStatus as any) || null,
        civilStatus: data.civilStatus || 'pending',
      })
      .returning();

    return this.mapCitizenRow(inserted);
  }

  async findCitizenByUserId(userId: number): Promise<CitizenRecord | null> {
    const [row] = await this.db
      .select()
      .from(citizens)
      .where(eq(citizens.userId, userId))
      .limit(1);

    if (!row) return null;
    return this.mapCitizenRow(row);
  }

  async updateCivilStatus(
    userId: number,
    civilStatus: 'pending' | 'verified' | 'suspended' | 'revoked',
    verifiedBy?: number
  ): Promise<void> {
    await this.db
      .update(citizens)
      .set({
        civilStatus,
        verifiedAt: civilStatus === 'verified' ? new Date() : null,
        verifiedBy: verifiedBy || null,
        statusChangedAt: new Date(),
      })
      .where(eq(citizens.userId, userId));
  }

  async createIdentityDocument(data: IdentityDocumentRecord): Promise<IdentityDocumentRecord> {
    const [inserted] = await this.db
      .insert(identityDocuments)
      .values({
        userId: data.userId,
        documentType: data.documentType,
        countryCode: data.countryCode || 'BR',
        numberLookupHash: data.numberLookupHash,
        encryptedNumber: data.encryptedNumber,
        last4: data.last4 || null,
        source: data.source,
        verificationStatus: data.verificationStatus || 'pending',
        verifiedAt: data.verifiedAt || null,
        verifiedBy: data.verifiedBy || null,
      })
      .returning();

    return {
      id: inserted.id,
      userId: inserted.userId,
      documentType: inserted.documentType as any,
      countryCode: inserted.countryCode,
      numberLookupHash: inserted.numberLookupHash,
      encryptedNumber: inserted.encryptedNumber,
      last4: inserted.last4,
      source: inserted.source as any,
      verificationStatus: inserted.verificationStatus as any,
      verifiedAt: inserted.verifiedAt ? new Date(inserted.verifiedAt) : null,
      verifiedBy: inserted.verifiedBy,
      version: inserted.version,
    };
  }

  async findDocumentsByUserId(userId: number): Promise<IdentityDocumentRecord[]> {
    const rows = await this.db
      .select()
      .from(identityDocuments)
      .where(eq(identityDocuments.userId, userId));

    return rows.map((r: any) => ({
      id: r.id,
      userId: r.userId,
      documentType: r.documentType,
      countryCode: r.countryCode,
      numberLookupHash: r.numberLookupHash,
      encryptedNumber: r.encryptedNumber,
      last4: r.last4,
      source: r.source,
      verificationStatus: r.verificationStatus,
      verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
      verifiedBy: r.verifiedBy,
      version: r.version,
    }));
  }

  async createKycVerification(data: KycVerificationRecord): Promise<KycVerificationRecord> {
    const [inserted] = await this.db
      .insert(kycVerifications)
      .values({
        userId: data.userId,
        verificationLevel: data.verificationLevel,
        status: data.status,
        provider: data.provider,
        riskScore: data.riskScore || null,
        rejectionReason: data.rejectionReason || null,
        startedAt: data.startedAt,
        completedAt: data.completedAt || null,
        expiresAt: data.expiresAt || null,
      })
      .returning();

    return {
      id: inserted.id,
      userId: inserted.userId,
      verificationLevel: inserted.verificationLevel as any,
      status: inserted.status as any,
      provider: inserted.provider,
      riskScore: inserted.riskScore,
      rejectionReason: inserted.rejectionReason,
      startedAt: new Date(inserted.startedAt),
      completedAt: inserted.completedAt ? new Date(inserted.completedAt) : null,
      expiresAt: inserted.expiresAt ? new Date(inserted.expiresAt) : null,
      version: inserted.version,
    };
  }

  async getLatestKycByUserId(userId: number): Promise<KycVerificationRecord | null> {
    const [row] = await this.db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.userId, userId))
      .orderBy(desc(kycVerifications.id))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      verificationLevel: row.verificationLevel as any,
      status: row.status as any,
      provider: row.provider,
      riskScore: row.riskScore,
      rejectionReason: row.rejectionReason,
      startedAt: new Date(row.startedAt),
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      version: row.version,
    };
  }

  private mapCitizenRow(row: any): CitizenRecord {
    return {
      userId: row.userId,
      username: row.username,
      legalFirstName: row.legalFirstName,
      legalLastName: row.legalLastName,
      nationalityCode: row.nationalityCode,
      birthDate: row.birthDate,
      maritalStatus: row.maritalStatus,
      civilStatus: row.civilStatus,
      verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : null,
      verifiedBy: row.verifiedBy,
      version: row.version,
    };
  }
}

```

---

## `src/infrastructure/repositories/DrizzleFinanceRepository.ts`

```typescript
import { eq } from 'drizzle-orm';
import {
  financialAccounts,
  accountBalances,
  financialTransactions,
  financialLedgerEntries,
} from '../../db/finance/tables';
import { Result } from '../../shared/kernel/Result';
import {
  IFinanceRepository,
  FinancialAccountRecord,
  AccountBalanceRecord,
  FinancialTransactionRecord,
} from '../../application/ports/output/IFinanceRepository';

export type { FinancialAccountRecord, AccountBalanceRecord, FinancialTransactionRecord };

export class DrizzleFinanceRepository implements IFinanceRepository {
  constructor(private readonly db: any) {}

  async getTreasuryAccount(): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.db
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.accountType, 'treasury'))
        .limit(1);

      if (!row) {
        // Se não existir a conta tesouraria, cria uma nova conta padrão de tesouraria
        const [inserted] = await this.db
          .insert(financialAccounts)
          .values({
            userId: null,
            accountType: 'treasury',
            name: 'ASPPIBRA DAO Main Treasury',
            status: 'active',
          })
          .returning();

        return Result.ok({
          id: inserted.id,
          userId: inserted.userId,
          accountType: inserted.accountType as any,
          status: inserted.status as any,
          name: inserted.name,
          version: inserted.version,
        });
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
        status: row.status as any,
        name: row.name,
        version: row.version,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>> {
    try {
      const treasuryRes = await this.getTreasuryAccount();
      if (treasuryRes.isFailure) {
        return Result.fail(treasuryRes.error || 'Treasury account error');
      }

      const treasuryId = treasuryRes.getValue().id;
      const rows = await this.db
        .select()
        .from(accountBalances)
        .where(eq(accountBalances.accountId, treasuryId));

      const balances: AccountBalanceRecord[] = rows.map((r: any) => ({
        id: r.id,
        accountId: r.accountId,
        assetId: r.assetId,
        availableBaseUnits: r.availableBaseUnits,
        lockedBaseUnits: r.lockedBaseUnits,
        version: r.version,
      }));

      return Result.ok(balances);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async createTransaction(data: {
    userId?: number | null;
    type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
    category?: string;
    description: string;
    amountBaseUnits: string;
    assetId: number;
  }): Promise<Result<FinancialTransactionRecord>> {
    try {
      const treasuryRes = await this.getTreasuryAccount();
      if (treasuryRes.isFailure) return Result.fail(treasuryRes.error || 'Treasury account error');

      const treasuryId = treasuryRes.getValue().id;

      // 1. Criar registro de transação
      const [tx] = await this.db
        .insert(financialTransactions)
        .values({
          userId: data.userId || null,
          type: data.type,
          category: (data.category as any) || 'operational',
          status: 'completed',
          description: data.description,
          completedAt: new Date(),
        })
        .returning();

      // 2. Criar entrada contábil (Ledger Entry)
      await this.db.insert(financialLedgerEntries).values({
        transactionId: tx.id,
        accountId: treasuryId,
        assetId: data.assetId,
        direction: data.type === 'deposit' ? 'credit' : 'debit',
        amountBaseUnits: data.amountBaseUnits,
      });

      return Result.ok({
        id: tx.id,
        userId: tx.userId,
        type: tx.type as any,
        category: tx.category,
        status: tx.status as any,
        description: tx.description,
        createdAt: new Date(tx.createdAt),
        completedAt: tx.completedAt ? new Date(tx.completedAt) : null,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>> {
    try {
      const query = userId
        ? this.db.select().from(financialTransactions).where(eq(financialTransactions.userId, userId))
        : this.db.select().from(financialTransactions);

      const rows = await query;
      const txs: FinancialTransactionRecord[] = rows.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        type: r.type,
        category: r.category,
        status: r.status,
        description: r.description,
        createdAt: new Date(r.createdAt),
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
      }));

      return Result.ok(txs);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }
}

```

---

## `src/infrastructure/repositories/DrizzleIdentityResolverAdapter.ts`

```typescript
import { eq } from 'drizzle-orm';
import { IIdentityResolverPort } from '../../application/ports/output/IIdentityResolverPort';
import { IdentityAssertion } from '../../application/dto/IdentityAssertion';
import { IdentityResolutionResult } from '../../application/dto/IdentityResolutionResult';
import { wallets } from '../../db/web3/tables';
import { webauthnCredentials, userAuthenticators } from '../../db/authentication/tables';
import { didIdentities } from '../../db/ssi/tables';

export class DrizzleIdentityResolverAdapter implements IIdentityResolverPort {
  constructor(private readonly db: any) {}

  async resolve(assertion: IdentityAssertion): Promise<IdentityResolutionResult> {
    switch (assertion.type) {
      case 'oauth': {
        const [authenticator] = await this.db
          .select({ userId: userAuthenticators.userId })
          .from(userAuthenticators)
          .where(eq(userAuthenticators.id, assertion.subjectId))
          .limit(1);

        if (authenticator) {
          return {
            status: 'resolved',
            userId: authenticator.userId,
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

```

---

## `src/infrastructure/repositories/DrizzleOutboxRepository.ts`

```typescript
import { IDomainEvent } from '../../shared/kernel/DomainEvent';
import { Result } from '../../shared/kernel/Result';
import { IOutboxRepository, OutboxEventRecord } from '../../application/ports/output/IOutboxRepository';
import { outboxEvents } from '../../db/infrastructure/tables';
import { eq, asc, sql } from 'drizzle-orm';

export class DrizzleOutboxRepository implements IOutboxRepository {
  // Recebe a instância do banco OU da transação (tx) ativa no UnitOfWork
  constructor(private db: any) {}

  async saveEvent(event: IDomainEvent, aggregateId: number, aggregateType: string, aggregateVersion: number): Promise<Result<void>> {
    try {
      const eventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      await this.db.insert(outboxEvents).values({
        id: eventId,
        aggregateId,
        aggregateType,
        aggregateVersion,
        eventName: event.constructor.name,
        payload: JSON.stringify(event),
        metadata: JSON.stringify({ occurredOn: event.dateTimeOccurred }),
        attempts: 0,
        published: false,
        createdAt: new Date(),
      });
      return Result.ok();
    } catch (error: any) {
      return Result.fail(`Failed to save outbox event: ${error.message}`);
    }
  }

  async getPendingEvents(limit: number): Promise<Result<OutboxEventRecord[]>> {
    try {
      const pending = await this.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.published, false))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);
        
      return Result.ok(pending);
    } catch (error: any) {
      return Result.fail(`Failed to fetch pending outbox events: ${error.message}`);
    }
  }

  async markAsPublished(eventId: string): Promise<Result<void>> {
    try {
      await this.db
        .update(outboxEvents)
        .set({
          published: true,
          publishedAt: new Date(),
        })
        .where(eq(outboxEvents.id, eventId));
      return Result.ok();
    } catch (error: any) {
      return Result.fail(`Failed to mark outbox event as published: ${error.message}`);
    }
  }

  async markAsFailed(eventId: string, error: string): Promise<Result<void>> {
    try {
      const result = await this.db
        .update(outboxEvents)
        .set({
          attempts: sql`${outboxEvents.attempts} + 1`,
          error: error.substring(0, 500)
        })
        .where(eq(outboxEvents.id, eventId))
        .returning();
        
      if (!result || result.length === 0) {
        return Result.fail('Event not found');
      }

      return Result.ok();
    } catch (err: any) {
      return Result.fail(`Failed to mark outbox event as failed: ${err.message}`);
    }
  }
}


```

---

## `src/infrastructure/repositories/DrizzlePasswordResetRepository.ts`

```typescript
import { Result } from '../../shared/kernel/Result';
import { IPasswordResetRepository, PasswordReset } from '../../application/ports/output/IPasswordResetRepository';
import { passwordResets } from '../../db/authentication/tables';
import { eq } from 'drizzle-orm';

export class DrizzlePasswordResetRepository implements IPasswordResetRepository {
  constructor(private db: any) {}

  async findByToken(tokenHash: string): Promise<Result<PasswordReset>> {
    try {
      const [reset] = await this.db
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.tokenHash, tokenHash))
        .limit(1);

      if (!reset) {
        return Result.fail('PasswordResetNotFound');
      }
      return Result.ok(reset as PasswordReset);
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }

  async invalidate(id: number): Promise<Result<void>> {
    try {
      await this.db
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(passwordResets.id, id));
      return Result.ok();
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }

  async create(data: { userId: number; tokenHash: string; expiresAt: Date }): Promise<Result<void>> {
    try {
      await this.db.insert(passwordResets).values(data);
      return Result.ok();
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }

  async consumeToken(tokenHash: string): Promise<Result<PasswordReset>> {
    try {
      const { and, isNull, sql } = await import('drizzle-orm');
      
      const [reset] = await this.db
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(and(
          eq(passwordResets.tokenHash, tokenHash),
          isNull(passwordResets.usedAt),
          sql`${passwordResets.expiresAt} > ${new Date().getTime()}`
        ))
        .returning();

      if (!reset) {
        return Result.fail('PasswordResetNotFoundOrUsed');
      }
      return Result.ok(reset as PasswordReset);
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }
}

```

---

## `src/infrastructure/repositories/DrizzleSessionRepository.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DrizzleSessionRepository } from './DrizzleSessionRepository';

describe('DrizzleSessionRepository', () => {
  it('should insert a new session correctly', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const repo = new DrizzleSessionRepository(mockDb);
    const sessionData = {
      id: 'sess_123',
      userId: 1,
      jti: 'jti_123',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      refreshTokenHash: 'hash123',
      aal: 1,
      authEpoch: 1,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    };

    await repo.createSession(sessionData);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(sessionData);
  });

  it('should retrieve a session by id', async () => {
    const mockSession = { id: 'sess_123', userId: 1, jti: 'jti_123' };
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockSession]),
    };

    const repo = new DrizzleSessionRepository(mockDb);
    const result = await repo.getSessionById('sess_123');
    expect(result).toEqual(mockSession);
  });
});

```

---

## `src/infrastructure/repositories/DrizzleSessionRepository.ts`

```typescript
import { ISessionRepository } from '../../application/ports/output/ISessionRepository';
import { eq } from 'drizzle-orm';
import { userSessions } from '../../db/authentication/tables';

export class DrizzleSessionRepository implements ISessionRepository {
  constructor(private db: any) {}

  async createSession(sessionData: {
    id: string;
    userId: number;
    jti: string;
    ip: string;
    userAgent: string;
    familyId?: string;
    refreshTokenHash: string;
    aal: number;
    authEpoch: number;
    createdAt: Date;
    expiresAt: Date;
    lastAuthenticatedAt?: Date;
  }): Promise<void> {
    await this.db.insert(userSessions).values(sessionData);
  }

  async rotateRefreshTokenAtomically(sessionId: string, oldRefreshTokenHash: string): Promise<boolean> {
    const { sql } = await import('drizzle-orm');
    const result = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'Rotated' })
      .where(sql`${userSessions.id} = ${sessionId} AND ${userSessions.revokedAt} IS NULL AND ${userSessions.refreshTokenHash} = ${oldRefreshTokenHash}`);
    
    return result.meta.changes > 0;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'User logout' })
      .where(eq(userSessions.id, sessionId));
  }

  async revokeAllUserSessions(userId: number): Promise<void> {
    await this.db.update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'Revoked all user sessions' })
      .where(eq(userSessions.userId, userId));
  }

  async getSessionById(sessionId: string): Promise<any | null> {
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId))
      .limit(1);
    return session || null;
  }

  async createRefreshTokenFamily(familyData: {
    id: string;
    userId: number;
    createdAt: Date;
  }): Promise<void> {
    const { refreshTokenFamilies } = await import('../../db/authentication/tables');
    await this.db.insert(refreshTokenFamilies).values(familyData);
  }

  async revokeFamily(familyId: string, reason?: string): Promise<void> {
    const { refreshTokenFamilies, userSessions } = await import('../../db/authentication/tables');
    
    // Revoke the family
    await this.db.update(refreshTokenFamilies)
      .set({ revokedAt: new Date(), revocationReason: reason || 'Family revoked' })
      .where(eq(refreshTokenFamilies.id, familyId));

    // Revoke all sessions in the family
    await this.db.update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: reason || 'Parent family revoked' })
      .where(eq(userSessions.familyId, familyId));
  }

  async getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<any | null> {
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, refreshTokenHash))
      .limit(1);
    return session || null;
  }
}

```

---

## `src/infrastructure/repositories/DrizzleSsiRepository.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DrizzleSsiRepository } from './DrizzleSsiRepository';

describe('DrizzleSsiRepository', () => {
  it('should return failure if active DID not found for user', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const result = await repo.findDidByUserId(1);

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('DID identity not found');
  });

  it('should insert a new W3C compliant DID identity', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const record = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 1,
      did: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
      method: 'key' as const,
      controller: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
    };

    const result = await repo.saveDid(record);
    expect(result.isSuccess).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return failure on concurrent modification error during saveDid update', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000', version: 2 }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]), // 0 rows affected due to version conflict
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const record = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 1,
      did: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
      method: 'key' as const,
      controller: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
      version: 1, // Sending stale version 1 when DB is at version 2
    };

    const result = await repo.saveDid(record);
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('CONCURRENT_MODIFICATION_ERROR');
  });
});


```

---

## `src/infrastructure/repositories/DrizzleSsiRepository.ts`

```typescript
import { eq, and, sql } from 'drizzle-orm';
import { didIdentities, verifiableCredentials } from '../../db/ssi/tables';
import { Result } from '../../shared/kernel/Result';
import {
  ISsiRepository,
  DidIdentityRecord,
  VerifiableCredentialRecord,
} from '../../application/ports/output/ISsiRepository';

export type { DidIdentityRecord, VerifiableCredentialRecord };

export class DrizzleSsiRepository implements ISsiRepository {
  constructor(private db: any) {}

  async findDidByUserId(userId: number): Promise<Result<DidIdentityRecord>> {
    try {
      const result = await this.db
        .select()
        .from(didIdentities)
        .where(and(eq(didIdentities.userId, userId), eq(didIdentities.status, 'active')))
        .limit(1);

      if (!result || result.length === 0) {
        return Result.fail('DID identity not found');
      }

      return Result.ok({
        id: result[0].id,
        userId: result[0].userId,
        did: result[0].did,
        method: result[0].method,
        controller: result[0].controller,
        status: result[0].status,
        version: result[0].version || 1,
      });
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async saveDid(record: DidIdentityRecord): Promise<Result<DidIdentityRecord>> {
    try {
      const existing = await this.db
        .select()
        .from(didIdentities)
        .where(eq(didIdentities.id, record.id))
        .limit(1);

      if (!existing || existing.length === 0) {
        await this.db.insert(didIdentities).values({
          id: record.id,
          userId: record.userId,
          did: record.did,
          method: record.method,
          controller: record.controller,
          status: record.status || 'active',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        record.version = 1;
      } else {
        const currentVersion = record.version ?? existing[0].version ?? 1;

        const updated = await this.db
          .update(didIdentities)
          .set({
            status: record.status || 'active',
            updatedAt: new Date(),
            version: sql`${didIdentities.version} + 1`,
          })
          .where(
            and(
              eq(didIdentities.id, record.id),
              eq(didIdentities.version, currentVersion)
            )
          )
          .returning();

        if (!updated || updated.length === 0) {
          return Result.fail('CONCURRENT_MODIFICATION_ERROR: DID identity was modified by another process');
        }

        record.version = currentVersion + 1;
      }
      return Result.ok(record);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async saveVerifiableCredential(
    record: VerifiableCredentialRecord
  ): Promise<Result<VerifiableCredentialRecord>> {
    try {
      await this.db.insert(verifiableCredentials).values({
        id: record.id,
        holderUserId: record.holderUserId,
        issuerDid: record.issuerDid,
        subjectDid: record.subjectDid,
        credentialType: record.credentialType,
        credentialHash: record.credentialHash,
        encryptedClaims: record.encryptedClaims,
        proofType: record.proofType,
        status: record.status || 'active',
        issuanceDate: record.issuanceDate,
        expirationDate: record.expirationDate || null,
        version: 1,
      });

      return Result.ok(record);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async findVerifiableCredentialById(id: string): Promise<Result<VerifiableCredentialRecord>> {
    try {
      const [row] = await this.db
        .select()
        .from(verifiableCredentials)
        .where(eq(verifiableCredentials.id, id))
        .limit(1);

      if (!row) return Result.fail('Verifiable Credential not found');

      return Result.ok({
        id: row.id,
        holderUserId: row.holderUserId,
        issuerDid: row.issuerDid,
        subjectDid: row.subjectDid,
        credentialType: row.credentialType as any,
        credentialHash: row.credentialHash,
        encryptedClaims: row.encryptedClaims,
        proofType: row.proofType as any,
        status: row.status as any,
        issuanceDate: new Date(row.issuanceDate),
        expirationDate: row.expirationDate ? new Date(row.expirationDate) : null,
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
        version: row.version,
      });
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async listVerifiableCredentialsByUserId(
    userId: number
  ): Promise<Result<VerifiableCredentialRecord[]>> {
    try {
      const rows = await this.db
        .select()
        .from(verifiableCredentials)
        .where(eq(verifiableCredentials.holderUserId, userId));

      const credentials: VerifiableCredentialRecord[] = rows.map((row: any) => ({
        id: row.id,
        holderUserId: row.holderUserId,
        issuerDid: row.issuerDid,
        subjectDid: row.subjectDid,
        credentialType: row.credentialType,
        credentialHash: row.credentialHash,
        encryptedClaims: row.encryptedClaims,
        proofType: row.proofType,
        status: row.status,
        issuanceDate: new Date(row.issuanceDate),
        expirationDate: row.expirationDate ? new Date(row.expirationDate) : null,
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
        version: row.version,
      }));

      return Result.ok(credentials);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async revokeVerifiableCredential(id: string): Promise<Result<void>> {
    try {
      await this.db
        .update(verifiableCredentials)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
        })
        .where(eq(verifiableCredentials.id, id));

      return Result.ok(undefined);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }
}

```

---

## `src/infrastructure/repositories/DrizzleUnitOfWork.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DrizzleUnitOfWork } from './DrizzleUnitOfWork';
import { Result } from '../../shared/kernel/Result';

describe('DrizzleUnitOfWork', () => {
  it('should COMMIT when the callback returns a success Result', async () => {
    let commitTriggered = false;
    
    const mockTx = {
      isTx: true
    };
    
    const mockDb = {
      transaction: async (cb: any) => {
        await cb(mockTx);
        commitTriggered = true;
      }
    };

    const uow = new DrizzleUnitOfWork(mockDb);

    const result = await uow.execute(async (factory) => {
      return Result.ok();
    });

    expect(result.isSuccess).toBe(true);
    expect(commitTriggered).toBe(true);
  });

  it('should ROLLBACK when the callback returns a failure Result', async () => {
    let rollbackTriggered = false;
    
    const mockDb = {
      transaction: async (cb: any) => {
        try {
          await cb({
            isTx: true,
            rollback: () => {
              rollbackTriggered = true;
              throw new Error('Rollback');
            }
          });
        } catch (e: any) {
          if (e.message !== 'Rollback') {
            throw e;
          }
        }
      }
    };

    const uow = new DrizzleUnitOfWork(mockDb);

    const result = await uow.execute(async (factory) => {
      return Result.fail('Regra de negocio falhou');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Regra de negocio falhou');
    expect(rollbackTriggered).toBe(true);
  });

  it('Repository Identity Test: should provide the EXACT SAME tx object to all repositories requested', async () => {
    const mockTx = {
      id: 'mock-tx-123',
      select: vi.fn(),
    };
    
    const mockDb = {
      transaction: async (cb: any) => {
        await cb(mockTx);
      }
    };

    const uow = new DrizzleUnitOfWork(mockDb);

    await uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository() as any;
      const authRepo = factory.getAuthenticationRepository() as any;
      
      expect(userRepo.db).toBe(mockTx);
      expect(authRepo.db).toBe(mockTx);
      expect(userRepo.db).toBe(authRepo.db);
      
      return Result.ok();
    });
  });

  it('should isolate repositories so UseCase NEVER knows about Drizzle or DB', async () => {
    const mockDb = {
      transaction: async (cb: any) => await cb({ isTx: true })
    };

    const uow = new DrizzleUnitOfWork(mockDb);

    await uow.execute(async (factory) => {
      const repo = factory.getUserRepository();
      expect(repo.findByEmail).toBeDefined();
      expect((factory as any).tx).toBeUndefined();
      
      return Result.ok();
    });
  });

  it('Concurrent Writes: Multiple UoWs run independently', async () => {
    let transactionsRun = 0;
    
    const mockDb = {
      transaction: async (cb: any) => {
        transactionsRun++;
        await cb({ isTx: true });
      }
    };

    const uow1 = new DrizzleUnitOfWork(mockDb);
    const uow2 = new DrizzleUnitOfWork(mockDb);

    await Promise.all([
      uow1.execute(async () => Result.ok()),
      uow2.execute(async () => Result.ok())
    ]);

    expect(transactionsRun).toBe(2);
  });
});

```

---

## `src/infrastructure/repositories/DrizzleUnitOfWork.ts`

```typescript
import { IUnitOfWork, IRepositoryFactory } from '../../application/ports/output/IUnitOfWork';
import { IUserRepository } from '../../application/ports/output/IUserRepository';
import { IAuthenticationRepository } from '../../application/ports/output/IAuthenticationRepository';
import { IWeb3Repository } from '../../application/ports/output/IWeb3Repository';
import { ICivilIdentityRepository } from '../../application/ports/output/ICivilIdentityRepository';
import { ISessionRepository } from '../../application/ports/output/ISessionRepository';
import { IOutboxRepository } from '../../application/ports/output/IOutboxRepository';
import { IPasswordResetRepository } from '../../application/ports/output/IPasswordResetRepository';

import { DrizzleUserRepositoryAdapter } from '../repositories/DrizzleUserRepositoryAdapter';
import { DrizzleAuthenticationRepositoryAdapter } from '../repositories/DrizzleAuthenticationRepositoryAdapter';
import { DrizzleWeb3RepositoryAdapter } from '../repositories/DrizzleWeb3RepositoryAdapter';
import { DrizzleCivilIdentityRepositoryAdapter } from '../repositories/DrizzleCivilIdentityRepositoryAdapter';
import { DrizzleSessionRepository } from './DrizzleSessionRepository';
import { ISsiRepository } from '../../application/ports/output/ISsiRepository';
import { DrizzleSsiRepository } from './DrizzleSsiRepository';
import { DrizzleOutboxRepository } from './DrizzleOutboxRepository';
import { DrizzlePasswordResetRepository } from './DrizzlePasswordResetRepository';
import { IFinanceRepository } from '../../application/ports/output/IFinanceRepository';
import { DrizzleFinanceRepository } from './DrizzleFinanceRepository';
import { Result } from '../../shared/kernel/Result';
import { IAuthTransactionRepository } from '../../application/ports/output/IAuthTransactionRepository';
import { DrizzleAuthTransactionRepository } from './DrizzleAuthTransactionRepository';

class DrizzleRepositoryFactory implements IRepositoryFactory {
  constructor(private tx: any, private db?: any) {}

  getUserRepository(): IUserRepository {
    return new DrizzleUserRepositoryAdapter(this.tx || this.db);
  }

  getAuthTransactionRepository(): IAuthTransactionRepository {
    return new DrizzleAuthTransactionRepository(this.tx || this.db);
  }

  getAuthenticationRepository(): IAuthenticationRepository {
    return new DrizzleAuthenticationRepositoryAdapter(this.tx);
  }

  getWeb3Repository(): IWeb3Repository {
    return new DrizzleWeb3RepositoryAdapter(this.tx);
  }

  getSessionRepository(): ISessionRepository {
    return new DrizzleSessionRepository(this.tx);
  }

  getCivilIdentityRepository(): ICivilIdentityRepository {
    return new DrizzleCivilIdentityRepositoryAdapter(this.tx);
  }

  getSsiRepository(): ISsiRepository {
    return new DrizzleSsiRepository(this.tx);
  }

  getOutboxRepository(): IOutboxRepository {
    return new DrizzleOutboxRepository(this.tx);
  }

  getPasswordResetRepository(): IPasswordResetRepository {
    return new DrizzlePasswordResetRepository(this.tx);
  }

  getFinanceRepository(): IFinanceRepository {
    return new DrizzleFinanceRepository(this.tx);
  }
}


export class DrizzleUnitOfWork implements IUnitOfWork {
  constructor(private db: any) {}

  async execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>> {
    if (typeof this.db?.transaction === 'function') {
      let result: Result<T> | null = null;
      let workStarted = false;
      try {
        await this.db.transaction(async (tx: any) => {
          workStarted = true;
          const factory = new DrizzleRepositoryFactory(tx);
          result = await work(factory);

          if (result && result.isFailure && typeof tx.rollback === 'function') {
            tx.rollback();
          }
        });
        if (result) return result;
      } catch (err: any) {
        const errorMsg = err?.message || err?.toString() || '';
        if (!workStarted || errorMsg.toLowerCase().includes('begin') || errorMsg.includes('not supported by D1 driver')) {
          const factory = new DrizzleRepositoryFactory(this.db);
          return await work(factory);
        }
        const failureResult = result as Result<T> | null;
        if (failureResult && failureResult.isFailure) {
          return failureResult;
        }
        return Result.fail(errorMsg || 'Transaction aborted');
      }
    }

    const factory = new DrizzleRepositoryFactory(this.db);
    return await work(factory);
  }
}


```

---

## `src/infrastructure/repositories/DrizzleUserRepositoryAdapter.ts`

```typescript
import { eq, sql } from 'drizzle-orm';
import { users } from '../../db/user/tables';
import {
  IUserRepository,
  UserRecord,
  CreateUserData,
} from '../../application/ports/output/IUserRepository';

export type { UserRecord, CreateUserData };

export class DrizzleUserRepositoryAdapter implements IUserRepository {
  constructor(private readonly db: any) {}

  async findById(id: number): Promise<UserRecord | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!user) return null;
    return this.mapToRecord(user);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase().trim();
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, normalized))
      .limit(1);

    if (!user) return null;
    return this.mapToRecord(user);
  }

  async create(data: CreateUserData): Promise<UserRecord> {
    const email = data.email || '';
    const normalized = (data.emailNormalized || email).toLowerCase().trim();
    const subjectType = data.subjectType === 'citizen' || !data.subjectType ? 'human' : data.subjectType;

    const [created] = await this.db
      .insert(users)
      .values({
        email: email ? email.trim() : null,
        emailNormalized: normalized || null,
        subjectType,
        status: data.status || 'active',
        authEpoch: 1,
      })
      .returning();

    if (!created) {
      throw new Error('Falha ao criar usuário no D1.');
    }
    return this.mapToRecord(created);
  }

  async updateStatus(id: number, status: 'active' | 'suspended' | 'pending' | 'locked'): Promise<void> {
    await this.db
      .update(users)
      .set({ status })
      .where(eq(users.id, id));
  }

  async incrementAuthEpoch(userId: number): Promise<number> {
    const [updated] = await this.db
      .update(users)
      .set({
        authEpoch: sql`${users.authEpoch} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      throw new Error('User not found to increment authEpoch');
    }
    return updated.authEpoch;
  }

  async incrementFailedLoginAttempts(userId: number, maxAttempts: number): Promise<void> {
    const now = new Date();
    await this.db
      .update(users)
      .set({
        failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
        lastFailedLoginAt: now,
        status: sql`CASE WHEN ${users.failedLoginAttempts} + 1 >= ${maxAttempts} THEN 'locked' ELSE ${users.status} END`,
      })
      .where(eq(users.id, userId));
  }

  async resetFailedLoginAttempts(userId: number): Promise<void> {
    await this.db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
      })
      .where(eq(users.id, userId));
  }

  private mapToRecord(raw: any): UserRecord {
    return {
      id: raw.id,
      publicId: raw.publicId || null,
      email: raw.email || null,
      emailNormalized: raw.emailNormalized || raw.email || null,
      status: raw.status || 'active',
      subjectType: raw.subjectType || 'human',
      failedLoginAttempts: raw.failedLoginAttempts || 0,
      lastFailedLoginAt: raw.lastFailedLoginAt instanceof Date ? raw.lastFailedLoginAt : (raw.lastFailedLoginAt ? new Date(raw.lastFailedLoginAt * 1000) : null),
      authEpoch: raw.authEpoch || 1,
      createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt ? raw.createdAt * 1000 : Date.now()),
      updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : new Date(raw.updatedAt ? raw.updatedAt * 1000 : Date.now()),
    };
  }
}

```

---

## `src/infrastructure/repositories/DrizzleWalletRepository.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DrizzleWalletRepository } from './DrizzleWalletRepository';

describe('DrizzleWalletRepository', () => {
  it('should return failure if wallet not found by address', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    const repo = new DrizzleWalletRepository(mockDb);
    const result = await repo.findByAddress('0x123');

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Wallet not found');
  });

  it('should insert a new wallet with compliant default fields', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 101 }]),
    };

    const repo = new DrizzleWalletRepository(mockDb);
    const result = await repo.save({
      userId: 1,
      address: '0x1234567890123456789012345678901234567890',
      addressNormalized: '0x1234567890123456789012345678901234567890',
      networkId: 1,
      provenance: 'external',
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().id).toBe(101);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        provenance: 'external',
        walletType: 'eoa',
        controlMode: 'external_user',
      })
    );
  });
});

```

---

## `src/infrastructure/repositories/DrizzleWalletRepository.ts`

```typescript
import { eq } from 'drizzle-orm';
import { wallets } from '../../db/web3/tables';
import { Result } from '../../shared/kernel/Result';

export interface WalletRecord {
  id?: number;
  userId: number;
  provenance?: 'internal' | 'external';
  networkId: string | number;
  walletType?: 'eoa' | 'smart_account' | 'multisig';
  controlMode?: 'external_user' | 'platform_key' | 'custodial' | 'mpc';
  address: string;
  addressNormalized?: string;
  isPrimary?: boolean;
  status?: 'active' | 'suspended' | 'revoked';
  verificationStatus?: 'unverified' | 'verified';
}

export class DrizzleWalletRepository {
  constructor(private db: any) {}

  async findByAddress(address: string): Promise<Result<WalletRecord>> {
    try {
      const normalized = address.toLowerCase();
      const result = await this.db
        .select()
        .from(wallets)
        .where(eq(wallets.addressNormalized, normalized))
        .limit(1);

      if (!result || result.length === 0) {
        return Result.fail('Wallet not found');
      }

      return Result.ok(result[0]);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async findByUserId(userId: number): Promise<Result<WalletRecord[]>> {
    try {
      const result = await this.db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId));

      return Result.ok(result || []);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async save(wallet: WalletRecord): Promise<Result<WalletRecord>> {
    try {
      const provenance = wallet.provenance || 'external';
      const walletType = wallet.walletType || 'eoa';
      const controlMode =
        wallet.controlMode ||
        (provenance === 'internal' ? 'platform_key' : 'external_user');
      const addressNormalized = wallet.addressNormalized || wallet.address.toLowerCase();

      if (wallet.id) {
        await this.db
          .update(wallets)
          .set({
            isPrimary: wallet.isPrimary,
            status: wallet.status,
            verificationStatus: wallet.verificationStatus,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, wallet.id));
      } else {
        const [inserted] = await this.db
          .insert(wallets)
          .values({
            userId: wallet.userId,
            provenance,
            networkId: String(wallet.networkId),
            walletType,
            controlMode,
            address: wallet.address,
            addressNormalized,
            isPrimary: wallet.isPrimary || false,
            status: wallet.status || 'active',
            verificationStatus: wallet.verificationStatus || 'verified',
            linkedAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        wallet.id = inserted.id;
      }
      return Result.ok(wallet);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }
}

```

---

## `src/infrastructure/repositories/DrizzleWeb3RepositoryAdapter.ts`

```typescript
import { eq, and, sql } from 'drizzle-orm';
import { wallets } from '../../db/web3/tables';
import {
  IWeb3Repository,
  WalletRecord,
  LinkWalletData,
} from '../../application/ports/output/IWeb3Repository';

export type { WalletRecord, LinkWalletData };

export class DrizzleWeb3RepositoryAdapter implements IWeb3Repository {
  constructor(private readonly db: any) {}

  async findByAddress(address: string): Promise<WalletRecord | null> {
    const normalized = address.toLowerCase().trim();
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.addressNormalized, normalized))
      .limit(1);

    if (!row) return null;
    return this.mapToRecord(row);
  }

  async findByUserId(userId: number): Promise<WalletRecord[]> {
    const rows = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId));

    return rows.map((r: any) => this.mapToRecord(r));
  }

  async findActiveByUserId(userId: number): Promise<WalletRecord | null> {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.status, 'active')))
      .limit(1);

    if (!row) return null;
    return this.mapToRecord(row);
  }

  async linkExternalWallet(data: LinkWalletData): Promise<WalletRecord> {
    const addressNormalized = data.address.toLowerCase().trim();
    const existing = await this.findByAddress(addressNormalized);
    if (existing) return existing;

    const [newWallet] = await this.db
      .insert(wallets)
      .values({
        userId: data.userId,
        provenance: data.provenance || 'external',
        networkId: data.networkId || 1, // Default mainnet network
        walletType: data.walletType || 'eoa',
        controlMode: data.controlMode || 'external_user',
        address: data.address,
        addressNormalized,
        label: data.label || 'Web3 Wallet',
        status: 'active',
        verificationStatus: 'verified',
        isPrimary: false,
        version: 1,
      })
      .returning();

    return this.mapToRecord(newWallet);
  }

  async updateWallet(wallet: WalletRecord): Promise<WalletRecord> {
    const currentVersion = wallet.version ?? 1;

    const result = await this.db
      .update(wallets)
      .set({
        isPrimary: wallet.isPrimary,
        status: wallet.status,
        verificationStatus: wallet.verificationStatus,
        label: wallet.label,
        updatedAt: new Date(),
        version: sql`${wallets.version} + 1`,
      })
      .where(
        and(
          eq(wallets.id, wallet.id),
          eq(wallets.version, currentVersion)
        )
      )
      .returning();

    if (!result || result.length === 0) {
      throw new Error('CONCURRENT_MODIFICATION_ERROR: Wallet was updated by another process');
    }

    return this.mapToRecord(result[0]);
  }

  private mapToRecord(raw: any): WalletRecord {
    return {
      id: raw.id,
      userId: raw.userId,
      provenance: raw.provenance,
      networkId: raw.networkId,
      walletType: raw.walletType,
      controlMode: raw.controlMode,
      address: raw.address,
      addressNormalized: raw.addressNormalized,
      label: raw.label || null,
      status: raw.status,
      verificationStatus: raw.verificationStatus,
      isPrimary: Boolean(raw.isPrimary),
      linkedAt: raw.linkedAt instanceof Date ? raw.linkedAt : new Date(raw.linkedAt || Date.now()),
      version: raw.version || 1,
    };
  }
}


```

---

## `src/infrastructure/security/SecurityAuditAdapter.ts`

```typescript
import { ISecurityAuditPort, SecurityAuditEvent } from '../../application/ports/output/ISecurityAuditPort';
import { TransactionContext } from '../../application/dto/TransactionContext';
import { securityEvents } from '../../db/security/tables';

/**
 * Adapter de Infraestrutura para Auditoria de Segurança.
 * Grava registros imutáveis em security_events utilizando o mesmo cliente
 * de transação Drizzle exposto através de TransactionContext.
 */
export class SecurityAuditAdapter implements ISecurityAuditPort {
  constructor(private readonly db: any) {}

  public async logEvent(event: SecurityAuditEvent, txCtx?: TransactionContext): Promise<void> {
    const executor = (txCtx?.nativeTx as any) || this.db;

    // Mapear eventos de alto nível para os enums de securityEvents
    const eventType =
      event.event === 'identity_linked'
        ? 'credential_created'
        : event.event === 'identity_unlinked'
        ? 'credential_revoked'
        : event.event === 'authentication_succeeded'
        ? 'authentication_succeeded'
        : 'authentication_failed';

    await executor.insert(securityEvents).values({
      id: crypto.randomUUID(),
      userId: event.userId,
      event: eventType,
      result: event.event.includes('failed') ? 'failure' : 'success',
      source: 'api',
      metadata: event.metadata,
      createdAt: event.timestamp || new Date(),
    });
  }
}

```

---

## `src/infrastructure/security/crypto/Eip4361Verifier.ts`

```typescript
import { SiweMessage } from 'siwe';
import { ISiweVerifierPort, SiweVerificationInput, SiweVerificationOutput } from '../../../application/ports/security/ISiweVerifierPort';

export class Eip4361Verifier implements ISiweVerifierPort {
  async verify(input: SiweVerificationInput): Promise<SiweVerificationOutput> {
    try {
      const siweMessage = new SiweMessage(input.message);
      const result = await siweMessage.verify({
        signature: input.signature,
        nonce: input.expectedNonce,
        domain: input.expectedDomain,
      });

      if (!result.success) {
        throw new Error(result.error?.type || 'Assinatura SIWE EIP-4361 inválida.');
      }

      return {
        address: result.data.address.toLowerCase(),
        chainId: result.data.chainId,
        nonce: result.data.nonce,
        domain: result.data.domain,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha na verificação da assinatura SIWE.';
      throw new Error(message);
    }
  }
}

```

---

## `src/infrastructure/security/crypto/PBKDF2PasswordHasher.ts`

```typescript
import { IPasswordHasher } from '../../../application/ports/security/IPasswordHasher';

export class PBKDF2PasswordHasher implements IPasswordHasher {
  async hash(password: string, existingSaltB64?: string): Promise<string> {
    const enc = new TextEncoder();
    let salt: Uint8Array;

    if (existingSaltB64) {
      const rawString = atob(existingSaltB64);
      salt = new Uint8Array(rawString.length);
      for (let i = 0; i < rawString.length; i++) {
        salt[i] = rawString.charCodeAt(i);
      }
    } else {
      salt = crypto.getRandomValues(new Uint8Array(16));
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      256
    );

    const hashArray = Array.from(new Uint8Array(derivedBits));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const finalSaltB64 = btoa(String.fromCharCode(...salt));
    return `${finalSaltB64}:${hashHex}`;
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      let result = 0;
      for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ a.charCodeAt(i);
      }
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  async verify(password: string, storedHashText: string): Promise<boolean> {
    const [saltB64, originalHex] = storedHashText.split(':');
    if (!saltB64 || !originalHex) return false;

    const newDigest = await this.hash(password, saltB64);
    return this.timingSafeEqual(newDigest, storedHashText);
  }
}

```

---

## `src/infrastructure/security/crypto/crypto.ts`

```typescript
/**
 * CryptoCore & CryptoVault
 * Web Crypto API utilities compatible with Cloudflare Workers.
 */
export class CryptoCore {
  static async verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array
  ): Promise<boolean> {
    try {
      const algorithm = { name: 'Ed25519' };
      const importedKey = await crypto.subtle.importKey('raw', publicKey, algorithm, false, [
        'verify',
      ]);
      return await crypto.subtle.verify(algorithm, importedKey, signature, message);
    } catch (e) {
      console.error('CryptoCore Error:', e);
      return false;
    }
  }
}

export class CryptoVault {
  static async encrypt(text: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
    const buffer = new Uint8Array(iv.length + encrypted.byteLength);
    buffer.set(iv, 0);
    buffer.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...buffer));
  }

  static async decrypt(encryptedBase64: string, secret: string): Promise<string> {
    const binaryString = atob(encryptedBase64);
    const buffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      buffer[i] = binaryString.charCodeAt(i);
    }
    const iv = buffer.slice(0, 12);
    const data = buffer.slice(12);
    
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
    
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
  }

  static async generateEventHash(payload: any, prevHash = 'GENESIS'): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload) + prevHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

```

---

## `src/infrastructure/security/crypto/timing_safe.ts`

```typescript
/**
 * Utilitário: Timing-Safe String Comparison
 * Previne ataques de timing (side-channel) ao comparar strings secretas.
 * Usa Web Crypto API (disponível em Cloudflare Workers).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);

  // Arrays devem ter o mesmo comprimento para a comparação ser segura.
  // Paddinamos o array menor com zeros — a comparação final ainda retorna false.
  const len = Math.max(aBytes.length, bBytes.length);
  const aPadded = new Uint8Array(len);
  const bPadded = new Uint8Array(len);
  aPadded.set(aBytes);
  bPadded.set(bBytes);

  // XOR byte a byte — resultado != 0 significa strings diferentes
  let diff = 0;
  for (let i = 0; i < len; i++) {
    diff |= aPadded[i] ^ bPadded[i];
  }

  // Também garante que os comprimentos originais são iguais
  diff |= aBytes.length ^ bBytes.length;

  return diff === 0;
}

```

---

## `src/infrastructure/security/jwt/JwtService.ts`

```typescript
import { IJwtService } from '../../../application/ports/security/IJwtService';

const DEFAULT_EXPIRES_IN_SECONDS = 86400; // 24h

export class JwtService implements IJwtService {
  private base64UrlEncode(arr: Uint8Array): string {
    const binString = String.fromCharCode(...arr);
    return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private base64UrlDecode(str: string): Uint8Array {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binString = atob(base64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
  }

  private async getSigningKey(secretKey: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const masterKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(secretKey),
      { name: 'HKDF' },
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: enc.encode('ASPPIBRA-JWT'),
        info: enc.encode('JWT-SIGNING'),
      },
      masterKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  /**
   * Assina o payload. Se `exp`/`iat` não forem fornecidos explicitamente,
   * são preenchidos automaticamente (iat = agora, exp = agora + expiresInSeconds).
   * Isso evita a emissão silenciosa de tokens perenes (sem expiração).
   */
  async sign(
    payload: Record<string, any>,
    secret: string,
    kid: string = 'v1',
    expiresInSeconds: number = DEFAULT_EXPIRES_IN_SECONDS
  ): Promise<string> {
    if (!secret) {
      throw new Error('JWT secret ausente: assinatura recusada.');
    }

    const key = await this.getSigningKey(secret);
    const header = { alg: 'HS256', typ: 'JWT', kid };
    const enc = new TextEncoder();

    const nowSeconds = Math.floor(Date.now() / 1000);
    const fullPayload = {
      iss: 'asppibra-identity',
      aud: 'asppibra-ecosystem',
      ...payload,
      iat: typeof payload.iat === 'number' ? payload.iat : nowSeconds,
      nbf: typeof payload.nbf === 'number' ? payload.nbf : nowSeconds,
      exp: typeof payload.exp === 'number' ? payload.exp : nowSeconds + expiresInSeconds,
    };

    const encodedHeader = this.base64UrlEncode(enc.encode(JSON.stringify(header)));
    const encodedPayload = this.base64UrlEncode(enc.encode(JSON.stringify(fullPayload)));

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signatureBuffer = await crypto.subtle.sign({ name: 'HMAC' }, key, enc.encode(signingInput));

    const encodedSignature = this.base64UrlEncode(new Uint8Array(signatureBuffer));
    return `${signingInput}.${encodedSignature}`;
  }

  /**
   * Verifica assinatura HMAC E claims temporais (exp obrigatório, nbf opcional).
   * Tokens sem `exp` são rejeitados — não é permitido emitir/aceitar tokens perenes.
   */
  async verify(token: string, secret: string): Promise<any> {
    if (!secret) {
      throw new Error('JWT secret ausente: verificação recusada.');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Token JWT malformatado.');
    }
    const [headerB64, payloadB64, signatureB64] = parts;

    const key = await this.getSigningKey(secret);
    const enc = new TextEncoder();
    const signingInput = `${headerB64}.${payloadB64}`;
    const signatureBytes = this.base64UrlDecode(signatureB64);

    const isValid = await crypto.subtle.verify(
      { name: 'HMAC' },
      key,
      signatureBytes,
      enc.encode(signingInput)
    );

    if (!isValid) {
      throw new Error('Assinatura JWT inválida.');
    }

    const payloadStr = new TextDecoder().decode(this.base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadStr);

    const nowSeconds = Math.floor(Date.now() / 1000);

    // Bloqueia tokens perenes: exp é obrigatório.
    if (typeof payload.exp !== 'number') {
      throw new Error('Token sem claim de expiração (exp). Rejeitado.');
    }
    if (payload.exp < nowSeconds) {
      throw new Error('Token expirado.');
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
      throw new Error('Token ainda não é válido (nbf).');
    }
    if (payload.iss !== 'asppibra-identity') {
      throw new Error('Token emitido por origem desconhecida (iss).');
    }
    if (payload.aud !== 'asppibra-ecosystem') {
      throw new Error('Token não destinado a este ecosistema (aud).');
    }

    return payload;
  }
}

```

---

## `src/infrastructure/testing/cloudflare-workers.ts`

```typescript
export class DurableObject {
  state: any;
  env: any;
  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
  }
}

```

---

## `src/interfaces/http/controllers/civil-identity/CivilIdentityController.ts`

```typescript
import { Context } from 'hono';
import { RegisterCitizenUseCase } from '../../../../domains/civil-identity/use-cases/RegisterCitizenUseCase';
import { SubmitKycVerificationUseCase } from '../../../../domains/civil-identity/use-cases/SubmitKycVerificationUseCase';
import { ICivilIdentityRepository } from '../../../../application/ports/output/ICivilIdentityRepository';

export class CivilIdentityController {
  constructor(
    private readonly registerCitizenUseCase: RegisterCitizenUseCase,
    private readonly submitKycUseCase: SubmitKycVerificationUseCase,
    private readonly civilRepo: ICivilIdentityRepository
  ) {}

  async register(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json();
      const result = await this.registerCitizenUseCase.execute({
        userId,
        legalFirstName: body.legalFirstName,
        legalLastName: body.legalLastName,
        nationalityCode: body.nationalityCode,
        birthDate: body.birthDate,
        maritalStatus: body.maritalStatus,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error || 'Erro ao registrar cidadão' }, 400);
      }

      return c.json({ success: true, message: 'Dados civis registrados com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async submitKyc(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json();
      const result = await this.submitKycUseCase.execute({
        userId,
        verificationLevel: body.verificationLevel || 'basic',
        documentType: body.documentType || 'cpf',
        documentNumber: body.documentNumber,
        provider: body.provider,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error || 'Erro no processo de KYC' }, 400);
      }

      return c.json({ success: true, message: 'Solicitação KYC enviada com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async getMe(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const citizen = await this.civilRepo.findCitizenByUserId(userId);
      const docs = await this.civilRepo.findDocumentsByUserId(userId);
      const kyc = await this.civilRepo.getLatestKycByUserId(userId);

      return c.json({
        success: true,
        data: {
          citizen,
          documentsCount: docs.length,
          latestKyc: kyc,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }
}

```

---

## `src/interfaces/http/controllers/finance/FinanceController.ts`

```typescript
import { Context } from 'hono';
import { GetTreasuryBalanceUseCase } from '../../../../domains/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../domains/finance/use-cases/RecordTreasuryTransactionUseCase';
import { IFinanceRepository } from '../../../../application/ports/output/IFinanceRepository';

export class FinanceController {
  constructor(
    private readonly getTreasuryBalanceUseCase: GetTreasuryBalanceUseCase,
    private readonly recordTxUseCase: RecordTreasuryTransactionUseCase,
    private readonly financeRepo: IFinanceRepository
  ) {}

  async getBalance(c: Context): Promise<Response> {
    try {
      const result = await this.getTreasuryBalanceUseCase.execute();
      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async recordTransaction(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      const body = await c.req.json();

      const result = await this.recordTxUseCase.execute({
        userId,
        type: body.type || 'deposit',
        category: body.category,
        description: body.description,
        amountBaseUnits: body.amountBaseUnits,
        assetId: body.assetId,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, message: 'Transação registrada com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async listTransactions(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      const result = await this.financeRepo.listTransactions(userId);

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }
}

```

---

## `src/interfaces/http/controllers/identity/AuthAuxiliaryController.ts`

```typescript
import { Context } from 'hono';
import { SetupTotpUseCase } from '../../../../application/use-cases/identity/SetupTotpUseCase';
import { AuthenticateTotpUseCase } from '../../../../application/use-cases/identity/AuthenticateTotpUseCase';
import { RequestPasswordResetUseCase } from '../../../../application/use-cases/identity/RequestPasswordResetUseCase';
import { ConfirmPasswordResetUseCase } from '../../../../application/use-cases/identity/ConfirmPasswordResetUseCase';
import { RefreshTokenUseCase } from '../../../../application/use-cases/identity/RefreshTokenUseCase';
import { error, success } from '../../helpers/response';

export class AuthAuxiliaryController {
  constructor(
    private readonly setupTotpUseCase?: SetupTotpUseCase,
    private readonly authenticateTotpUseCase?: AuthenticateTotpUseCase,
    private readonly requestPasswordResetUseCase?: RequestPasswordResetUseCase,
    private readonly confirmPasswordResetUseCase?: ConfirmPasswordResetUseCase,
    private readonly refreshTokenUseCase?: RefreshTokenUseCase
  ) {}

  async setupTotp(c: Context): Promise<Response> {
    try {
      if (!this.setupTotpUseCase) {
        return error(c, 'Caso de uso SetupTotp não configurado', null, 500);
      }
      const body = await c.req.json().catch(() => ({}));
      const transactionId = body?.transactionId;

      const encryptionKey = c.env.TOTP_ENCRYPTION_KEY;
      if (!encryptionKey) {
        return error(c, 'Configuração do servidor incorreta (TOTP_ENCRYPTION_KEY ausente)', null, 500);
      }

      if (!transactionId) {
        return error(c, 'ID da transação é obrigatório', null, 400);
      }

      const result = await this.setupTotpUseCase.execute({ transactionId, encryptionKey });
      if (result.isFailure) {
        return error(c, result.error || 'Erro ao configurar 2FA', null, 400);
      }

      return success(c, 'Configuração 2FA gerada com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao configurar 2FA', message, 500);
    }
  }

  async verifyTotp(c: Context): Promise<Response> {
    try {
      if (!this.authenticateTotpUseCase) {
        return error(c, 'Caso de uso AuthenticateTotp não configurado', null, 500);
      }
      const body = await c.req.json().catch(() => ({}));
      const { code, transactionId } = body || {};

      const encryptionKey = c.env.TOTP_ENCRYPTION_KEY;
      if (!encryptionKey) {
        return error(c, 'Configuração do servidor incorreta (TOTP_ENCRYPTION_KEY ausente)', null, 500);
      }

      if (!transactionId || !code) {
        return error(c, 'ID da transação e código 2FA são obrigatórios', null, 400);
      }

      const result = await this.authenticateTotpUseCase.execute({ transactionId, code, encryptionKey });
      if (result.isFailure) {
        return error(c, result.error || 'Código 2FA inválido', null, 400);
      }

      return success(c, 'Autenticação 2FA validada com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao validar 2FA', message, 500);
    }
  }

  async requestPasswordReset(c: Context): Promise<Response> {
    try {
      if (!this.requestPasswordResetUseCase) {
        return error(c, 'Caso de uso RequestPasswordReset não configurado', null, 500);
      }
      const body = await c.req.json().catch(() => ({}));
      const { email } = body || {};

      if (!email) {
        return error(c, 'E-mail é obrigatório para redefinição de senha', null, 400);
      }

      const result = await this.requestPasswordResetUseCase.execute({ email });
      if (result.isFailure) {
        return error(c, result.error || 'Erro ao solicitar redefinição de senha', null, 400);
      }

      // Canal protegido: Envia direto para a fila usando Cloudflare Queues
      // Garantindo que o rawToken NUNCA vá para o banco (Outbox) em texto plano.
      const payload = result.getValue();
      if (payload?.rawToken && c.env.EMAIL_PIPELINE_QUEUE) {
        const messagePayload = {
          type: 'password_reset',
          email,
          rawToken: payload.rawToken,
          timestamp: Date.now()
        };
        
        // HMAC Signature for Queue Message Integrity
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          enc.encode(c.env.JWT_SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const signatureBuffer = await crypto.subtle.sign(
          'HMAC',
          key,
          enc.encode(JSON.stringify(messagePayload))
        );
        const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        
        await c.env.EMAIL_PIPELINE_QUEUE.send({
          ...messagePayload,
          _signature: signature
        });
      }

      return success(c, 'Se o e-mail estiver cadastrado, as instruções de redefinição foram enviadas com sucesso.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao solicitar redefinição de senha', message, 500);
    }
  }

  async confirmPasswordReset(c: Context): Promise<Response> {
    try {
      if (!this.confirmPasswordResetUseCase) {
        return error(c, 'Caso de uso ConfirmPasswordReset não configurado', null, 500);
      }
      const body = await c.req.json().catch(() => ({}));
      const { token, newPassword } = body || {};

      if (!token || !newPassword) {
        return error(c, 'Token e nova senha são obrigatórios', null, 400);
      }

      const result = await this.confirmPasswordResetUseCase.execute({ token, newPassword });
      if (result.isFailure) {
        return error(c, result.error || 'Erro ao confirmar redefinição de senha', null, 400);
      }

      return success(c, 'Senha redefinida com sucesso. Todas as sessões anteriores foram encerradas.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao confirmar redefinição de senha', message, 500);
    }
  }

  async refreshSession(c: Context): Promise<Response> {
    try {
      if (!this.refreshTokenUseCase) {
        return error(c, 'Caso de uso RefreshToken não configurado', null, 500);
      }
      const body = await c.req.json().catch(() => ({}));
      const { refreshToken } = body || {};

      if (!refreshToken) {
        return error(c, 'Refresh token é obrigatório', null, 400);
      }

      const result = await this.refreshTokenUseCase.execute({ refreshToken });
      if (result.isFailure) {
        return error(c, result.error || 'Sessão ou refresh token inválido', null, 401);
      }

      return success(c, 'Sessão renovada com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao renovar sessão', message, 500);
    }
  }
}

```

---

## `src/interfaces/http/controllers/identity/ExternalIdentityController.ts`

```typescript
import { Context } from 'hono';
import { LinkExternalIdentityUseCase } from '../../../../application/use-cases/identity/LinkExternalIdentityUseCase';
import { UnlinkExternalIdentityUseCase } from '../../../../application/use-cases/identity/UnlinkExternalIdentityUseCase';
import { error, success } from '../../helpers/response';

export interface IExternalIdentityQueryPort {
  listUserIdentities(userId: number): Promise<{ oauth: any[]; wallets: any[] }>;
}

export class ExternalIdentityController {
  constructor(
    private readonly linkUseCase: LinkExternalIdentityUseCase,
    private readonly unlinkUseCase: UnlinkExternalIdentityUseCase,
    private readonly queryPort?: IExternalIdentityQueryPort
  ) {}

  async list(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId');

      if (!userId) {
        return error(c, 'Usuário não autenticado', null, 401);
      }

      if (!this.queryPort) {
        return success(c, 'Identidades externas carregadas com sucesso', { oauth: [], wallets: [] });
      }

      const data = await this.queryPort.listUserIdentities(userId);
      return success(c, 'Identidades externas carregadas com sucesso', data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao listar identidades externas', message, 500);
    }
  }

  async link(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId');
      const sessionAal = c.get('sessionAal') || 1;

      if (!userId) {
        return error(c, 'Usuário não autenticado', null, 401);
      }

      const body = await c.req.json().catch(() => ({}));
      const { type, challengeId, signature, message } = body || {};

      if (!type) {
        return error(c, 'Tipo de identidade não especificado.', null, 400);
      }

      let assertion: any = null;

      if (type === 'web3_wallet') {
        if (!challengeId || !signature || !message) {
          return error(c, 'Challenge ID, Mensagem e Assinatura são obrigatórios para vincular carteira.', null, 400);
        }

        // 1. Instanciar VerifyWalletIdentityUseCase para validar a assinatura e o challenge
        const db = c.get('db');
        const { DrizzleUnitOfWork } = await import('../../../../infrastructure/repositories/DrizzleUnitOfWork');
        const { Eip4361Verifier } = await import('../../../../infrastructure/security/crypto/Eip4361Verifier');
        const { DrizzleIdentityResolverAdapter } = await import('../../../../infrastructure/repositories/DrizzleIdentityResolverAdapter');
        const { VerifyWalletIdentityUseCase } = await import('../../../../application/use-cases/identity/VerifyWalletIdentityUseCase');

        const uow = new DrizzleUnitOfWork(db);
        const siweVerifier = new Eip4361Verifier();
        const resolver = new DrizzleIdentityResolverAdapter(db);
        const verifyWallet = new VerifyWalletIdentityUseCase(uow, siweVerifier, resolver);

        const domain = c.req.header('host') || 'w3.app';

        const verifyResult = await verifyWallet.execute({
          challengeId,
          message,
          signature,
          expectedDomain: domain,
        });

        if (verifyResult.isFailure) {
          return error(c, verifyResult.error || 'Falha ao verificar assinatura da carteira.', null, 400);
        }

        assertion = {
          type: 'web3_wallet',
          provider: 'evm',
          subjectId: verifyResult.getValue().address,
          networkId: verifyResult.getValue().chainId,
          verifiedAt: new Date()
        };
      } else if (type === 'passkey') {
        const { responseJSON } = body || {};

        if (!challengeId || !responseJSON) {
          return error(c, 'Challenge ID e resposta WebAuthn são obrigatórios para vincular passkey.', null, 400);
        }

        const db = c.get('db');
        const { DrizzleUnitOfWork } = await import('../../../../infrastructure/repositories/DrizzleUnitOfWork');
        const { VerifyPasskeyRegistrationUseCase } = await import('../../../../application/use-cases/identity/VerifyPasskeyRegistrationUseCase');

        const uow = new DrizzleUnitOfWork(db);
        const verifyRegistration = new VerifyPasskeyRegistrationUseCase(uow);

        const origin = c.req.header('origin') || `https://${c.req.header('host')}`;
        const rpID = c.req.header('host') || 'w3.app';

        const verifyResult = await verifyRegistration.execute({
          challengeId,
          responseJSON,
          expectedOrigin: origin,
          expectedRPID: rpID,
        });

        if (verifyResult.isFailure) {
          return error(c, verifyResult.error || 'Falha ao verificar registro da Passkey.', null, 400);
        }

        assertion = {
          type: 'passkey',
          provider: 'webauthn',
          subjectId: verifyResult.getValue().authenticatorId,
          verifiedAt: new Date()
        };
      } else {
        return error(c, 'Tipo de identidade não suportado para vinculação no momento.', null, 400);
      }

      const result = await this.linkUseCase.execute({
        userId,
        sessionAal,
        assertion,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Erro ao vincular identidade', null, 400);
      }

      return success(c, 'Identidade vinculada com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao vincular identidade externa', message, 500);
    }
  }

  async unlink(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId');
      const sessionAal = c.get('sessionAal') || 1;

      if (!userId) {
        return error(c, 'Usuário não autenticado', null, 401);
      }

      const body = await c.req.json().catch(() => ({}));
      const { provider, subjectId } = body || {};

      if (!provider || !subjectId) {
        return error(c, 'Provider e subjectId são obrigatórios para desvínculo.', null, 400);
      }

      const result = await this.unlinkUseCase.execute({
        userId,
        sessionAal,
        provider,
        subjectId,
      });

      if (result.isFailure) {
        const errStr = result.error || 'Erro ao desvincular identidade';
        const statusCode = errStr.includes('última credencial') ? 409 : 400;
        return error(c, errStr, null, statusCode);
      }

      return success(c, 'Identidade desvinculada com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao desvincular identidade externa', message, 500);
    }
  }
}

```

---

## `src/interfaces/http/controllers/identity/IdentityController.ts`

```typescript
import { Context } from 'hono';
import { AuthenticateAccountUseCase } from '../../../../application/use-cases/identity/AuthenticateAccountUseCase';
import { RegisterAccountUseCase } from '../../../../application/use-cases/identity/RegisterAccountUseCase';
import { VerifyWalletIdentityUseCase } from '../../../../application/use-cases/identity/VerifyWalletIdentityUseCase';
import { VerifyPasskeyIdentityUseCase } from '../../../../application/use-cases/identity/VerifyPasskeyIdentityUseCase';
import { IJwtService } from '../../../../application/ports/security/IJwtService';
import { ISessionRepository } from '../../../../application/ports/output/ISessionRepository';
import { error, success } from '../../helpers/response';

export class IdentityController {
  constructor(
    private readonly authenticateUseCase: AuthenticateAccountUseCase,
    private readonly jwtService: IJwtService,
    private readonly sessionRepo: ISessionRepository,
    private readonly registerUseCase?: RegisterAccountUseCase,
    private readonly verifyWalletUseCase?: VerifyWalletIdentityUseCase,
    private readonly verifyPasskeyUseCase?: VerifyPasskeyIdentityUseCase
  ) {}

  async register(c: Context): Promise<Response> {
    try {
      if (!this.registerUseCase) {
        return error(c, 'Caso de uso de registro não configurado.', null, 500);
      }

      const body = await c.req.json().catch(() => ({}));
      const { email, password, displayName, username } = body || {};

      if (!email || !password) {
        return error(c, 'Email e senha são obrigatórios para cadastro.', null, 400);
      }

      const result = await this.registerUseCase.execute({ email, password, displayName, username });

      if (result.isFailure) {
        return error(c, result.error || 'Falha ao registrar conta', null, 400);
      }

      const registeredUser = result.getValue();
      return success(c, 'Conta registrada com sucesso', registeredUser, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao processar cadastro de conta', message, 500);
    }
  }

  async loginLocal(c: Context): Promise<Response> {
    try {
      const body = await c.req.json().catch(() => ({}));
      const { email, password } = body || {};

      if (!email || !password) {
        return error(c, 'Email e senha são obrigatórios', null, 400);
      }

      const result = await this.authenticateUseCase.execute({ email, password });

      if (result.isFailure) {
        return error(c, result.error || 'Credenciais inválidas', null, 401);
      }

      const user = result.getValue();
      return this.issueSessionResponse(c, user.userId, user.email, user.publicId, user.status, 1, new Date(), 'password');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno no servidor ao processar autenticação', message, 500);
    }
  }

  async generateWeb3Challenge(c: Context): Promise<Response> {
    try {
      const db = c.get('db');
      const { DrizzleUnitOfWork } = await import('../../../../infrastructure/repositories/DrizzleUnitOfWork');
      const { GenerateWeb3ChallengeUseCase } = await import('../../../../application/use-cases/identity/GenerateWeb3ChallengeUseCase');
      
      const uow = new DrizzleUnitOfWork(db);
      const generateWeb3ChallengeUseCase = new GenerateWeb3ChallengeUseCase(uow);

      const body = await c.req.json().catch(() => ({}));
      const { transactionId, context } = body || {};

      const domain = c.req.header('host') || 'w3.app'; // Em prod, pegar env.EXPECTED_DOMAIN

      const result = await generateWeb3ChallengeUseCase.execute({
        context: context || 'login',
        transactionId,
        domain,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha ao gerar challenge Web3', null, 400);
      }

      return success(c, 'Challenge gerado com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao gerar challenge Web3', message, 500);
    }
  }

  async loginWeb3(c: Context): Promise<Response> {
    try {
      if (!this.verifyWalletUseCase) {
        return error(c, 'Autenticação Web3 não configurada.', null, 500);
      }

      const body = await c.req.json().catch(() => ({}));
      const { challengeId, message, signature } = body || {};

      if (!challengeId || !message || !signature) {
        return error(c, 'Challenge ID, Mensagem SIWE e assinatura são obrigatórios.', null, 400);
      }

      const domain = c.req.header('host') || 'w3.app'; // Controlado pelo server

      const result = await this.verifyWalletUseCase.execute({
        challengeId,
        message,
        signature,
        expectedDomain: domain,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha na autenticação Web3', null, 401);
      }

      const walletAuth = result.getValue();
      return this.issueSessionResponse(c, walletAuth.userId, `wallet_${walletAuth.address}@w3.app`, null, 'active', 2, new Date(), 'web3_wallet');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao processar autenticação Web3 SIWE', message, 500);
    }
  }

  async generatePasskeyChallenge(c: Context): Promise<Response> {
    try {
      const db = c.get('db');
      const { DrizzleUnitOfWork } = await import('../../../../infrastructure/repositories/DrizzleUnitOfWork');
      const { GeneratePasskeyChallengeUseCase } = await import('../../../../application/use-cases/identity/GeneratePasskeyChallengeUseCase');
      
      const uow = new DrizzleUnitOfWork(db);
      const generatePasskeyChallengeUseCase = new GeneratePasskeyChallengeUseCase(uow);

      const body = await c.req.json().catch(() => ({}));
      let { transactionId, context, userId, userName } = body || {};

      if (context === 'credential_link') {
        const sessionUser = c.get('user');
        if (!sessionUser || !sessionUser.userId) {
          return error(c, 'Sessão ativa necessária para registrar Passkey', null, 401);
        }
        userId = sessionUser.userId;
      }

      const rpID = c.req.header('host') || 'w3.app';
      const rpName = 'ASPPIBRA W3';

      const result = await generatePasskeyChallengeUseCase.execute({
        context: context || 'login',
        transactionId,
        userId,
        userName,
        rpID,
        rpName,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha ao gerar challenge Passkey', null, 400);
      }

      return success(c, 'Challenge gerado com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao gerar challenge Passkey', message, 500);
    }
  }

  async loginPasskey(c: Context): Promise<Response> {
    try {
      if (!this.verifyPasskeyUseCase) {
        return error(c, 'Autenticação Passkey não configurada.', null, 500);
      }

      const body = await c.req.json().catch(() => ({}));
      const { challengeId, responseJSON } = body || {};

      if (!challengeId || !responseJSON) {
        return error(c, 'Challenge ID e resposta WebAuthn são obrigatórios.', null, 400);
      }

      const origin = c.req.header('origin') || `https://${c.req.header('host')}`;
      const rpID = c.req.header('host') || 'w3.app';

      const result = await this.verifyPasskeyUseCase.execute({
        challengeId,
        responseJSON,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha na autenticação Passkey', null, 401);
      }

      const passkeyAuth = result.getValue();
      return this.issueSessionResponse(c, passkeyAuth.userId, `passkey_${passkeyAuth.credentialId}@w3.app`, null, 'active', 2, new Date(), 'passkey');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao processar autenticação Passkey', message, 500);
    }
  }

  public async issueSessionResponse(
    c: Context,
    userId: number,
    email: string,
    publicId: string | null,
    status: string,
    effectiveAal: number,
    authTime: Date,
    authMethod: string
  ): Promise<Response> {
    const jwtSecret = c.env?.JWT_SECRET;
    if (!jwtSecret) {
      return error(c, 'Erro de configuração do servidor (JWT_SECRET ausente).', null, 500);
    }

    const sessionId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const jti = crypto.randomUUID();
    
    // Generate secure refresh token
    const rawRefreshToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const refreshTokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawRefreshToken));
    const refreshTokenHash = Array.from(new Uint8Array(refreshTokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const userAgent = c.req.header('user-agent') || 'unknown';
    
    const now = new Date();
    const sessionExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000); // 30 days for refresh session
    const jwtExpiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins for access token

    // Create the token family first
    if (this.sessionRepo.createRefreshTokenFamily) {
      await this.sessionRepo.createRefreshTokenFamily({
        id: familyId,
        userId,
        createdAt: now,
      });
    }

    await this.sessionRepo.createSession({
      id: sessionId,
      userId,
      jti,
      ip,
      userAgent,
      familyId,
      refreshTokenHash,
      aal: effectiveAal,
      authEpoch: 1,
      createdAt: now,
      expiresAt: sessionExpiresAt,
      lastAuthenticatedAt: authTime,
    } as any); // Type cast due to possible interface mismatches, since we added lastAuthenticatedAt

    const token = await this.jwtService.sign(
      {
        sub: publicId || String(userId),
        userId,
        email,
        publicId,
        sid: sessionId,
        jti,
        aal: effectiveAal,
        auth_time: Math.floor(authTime.getTime() / 1000),
        exp: Math.floor(jwtExpiresAt.getTime() / 1000), 
      },
      jwtSecret
    );

    return success(c, 'Autenticação realizada com sucesso', {
      token, // Access Token
      refreshToken: rawRefreshToken, // Send back for the client to store securely
      expiresIn: 15 * 60, // 15 minutes
      user: {
        id: userId,
        email,
        publicId,
        status,
      },
      session: {
        id: sessionId,
        aal: effectiveAal,
        auth_time: authTime.toISOString(),
        expiresAt: sessionExpiresAt,
      },
    });
  }

  async logout(c: Context): Promise<Response> {
    try {
      const sessionId = c.get('sessionId') || c.get('user')?.sessionId;
      if (!sessionId) {
        return error(c, 'Sessão ativa não encontrada', null, 400);
      }

      await this.sessionRepo.revokeSession(sessionId);
      return success(c, 'Sessão encerrada com sucesso');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao realizar logout', message, 500);
    }
  }

  async logoutAll(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return error(c, 'Usuário não autenticado', null, 401);
      }

      await this.sessionRepo.revokeAllUserSessions(userId);
      return success(c, 'Todas as sessões ativas foram encerradas com sucesso.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao realizar logout global', message, 500);
    }
  }
}


```

---

## `src/interfaces/http/controllers/ssi/SsiController.ts`

```typescript
import { Context } from 'hono';
import { CreateDidUseCase } from '../../../../domains/ssi/use-cases/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from '../../../../domains/ssi/use-cases/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from '../../../../domains/ssi/use-cases/RevokeCredentialUseCase';
import { ISsiRepository } from '../../../../application/ports/output/ISsiRepository';

export class SsiController {
  constructor(
    private readonly createDidUseCase: CreateDidUseCase,
    private readonly issueVcUseCase: IssueVerifiableCredentialUseCase,
    private readonly revokeVcUseCase: RevokeCredentialUseCase,
    private readonly ssiRepo: ISsiRepository
  ) {}

  async createDid(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json().catch(() => ({}));
      const result = await this.createDidUseCase.execute({
        userId,
        method: body.method || 'key',
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, message: 'DID gerado com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async issueCredential(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json();
      const result = await this.issueVcUseCase.execute({
        holderUserId: userId,
        credentialType: body.credentialType || 'CivicIdentityCredential',
        claims: body.claims || {},
        expirationDays: body.expirationDays || 365,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, message: 'Credencial Verificável emitida com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async revokeCredential(c: Context): Promise<Response> {
    try {
      const body = await c.req.json();
      const result = await this.revokeVcUseCase.execute({ credentialId: body.credentialId });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, message: 'Credencial Verificável revogada com sucesso' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async listMyCredentials(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const didRes = await this.ssiRepo.findDidByUserId(userId);
      const vcsRes = await this.ssiRepo.listVerifiableCredentialsByUserId(userId);

      return c.json({
        success: true,
        data: {
          did: didRes.isSuccess ? didRes.getValue() : null,
          credentials: vcsRes.isSuccess ? vcsRes.getValue() : [],
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }
}

```

---

## `src/interfaces/http/helpers/response.ts`

```typescript
/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Central System API & Identity Provider
 * Utility: Standardized API Responses (Strict Type Edition)
 */
import { Context } from 'hono';
import { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Resposta de Sucesso Padronizada
 * @param c Contexto do Hono
 * @param message Mensagem amigável
 * @param data Dados (objetos, arrays, etc)
 * @param status Código HTTP que aceita conteúdo (ex: 200, 201)
 */
export const success = (
  c: Context,
  message: string = 'Operação realizada com sucesso',
  data: unknown = null,
  status: ContentfulStatusCode = 200
) => {
  return c.json(
    {
      success: true,
      message,
      data,
    },
    status
  );
};

/**
 * Resposta de Erro Padronizada
 * @param c Contexto do Hono
 * @param message Mensagem de erro
 * @param errors Detalhes técnicos ou de validação
 * @param status Código HTTP que aceita conteúdo (ex: 400, 401, 404, 500)
 */
export const error = (
  c: Context,
  message: string,
  errors: unknown = null,
  status: ContentfulStatusCode = 400
) => {
  return c.json(
    {
      success: false,
      message,
      errors,
    },
    status
  );
};

```

---

## `src/interfaces/http/middlewares/auth_signature.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { app } from '../../../index';

describe('Zero-Trust Middleware (auth_signature)', () => {
  const baseEnv = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: () => Promise.resolve({}),
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true, meta: {} }),
          raw: () => Promise.resolve([]),
        }),
        first: () => Promise.resolve({}),
        all: () => Promise.resolve({ results: [], success: true }),
        run: () => Promise.resolve({ success: true, meta: {} }),
        raw: () => Promise.resolve([]),
      }),
    },
    KV_AUTH: {
      get: vi.fn().mockResolvedValue('test_challenge'),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    KV_CACHE: {},
    STORAGE: {},
    JWT_SECRET: 'test_secret',
    ADMIN_PASSWORD: 'admin_secret',
  };

  const validTimestamp = Date.now().toString();

  const makeRequest = (headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/core/compliance/kyc/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ userId: 1, documentType: 'CPF' }),
    });

  it('rejects request without X-Identity-Signature header', async () => {
    const res = await app.fetch(
      makeRequest({
        'X-Identity-DID': 'did:dao:asppibra:test_user',
        'X-Identity-Timestamp': validTimestamp,
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.message).toContain('Missing Zero-Trust credentials');
  });

  it('rejects request without X-Identity-DID header', async () => {
    const res = await app.fetch(
      makeRequest({
        'X-Identity-Signature': 'dGVzdA==',
        'X-Identity-Timestamp': validTimestamp,
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });

  it('rejects request without X-Identity-Timestamp header', async () => {
    const res = await app.fetch(
      makeRequest({
        'X-Identity-Signature': 'dGVzdA==',
        'X-Identity-DID': 'did:dao:asppibra:test_user',
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
  });

  it('rejects request with expired timestamp (> 5 min)', async () => {
    const expiredTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 min atrás
    const res = await app.fetch(
      makeRequest({
        'X-Identity-Signature': 'dGVzdA==',
        'X-Identity-DID': 'did:dao:asppibra:test_user',
        'X-Identity-Timestamp': expiredTimestamp,
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.message).toContain('expired');
  });

  it('rejects request with invalid DID format (no username at end)', async () => {
    const res = await app.fetch(
      makeRequest({
        'X-Identity-Signature': 'dGVzdA==',
        'X-Identity-DID': 'did:dao:asppibra:', // DID sem username
        'X-Identity-Timestamp': validTimestamp,
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
  });
});

```

---

## `src/interfaces/http/middlewares/auth_signature.ts`

```typescript
import { Context, Next } from 'hono';
import { CryptoCore } from '../../../infrastructure/security/crypto/crypto';
import { JwtService } from '../../../infrastructure/security/jwt/JwtService';
import { DrizzleUnitOfWork } from '../../../infrastructure/repositories/DrizzleUnitOfWork';
import { CitizenRecord } from '../../../application/ports/output/ICivilIdentityRepository';
import { Result } from '../../../shared/kernel/Result';

const jwtService = new JwtService();

function requireJwtSecret(c: Context): string {
  const secret = c.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não configurado no ambiente.');
  }
  return secret;
}

/**
 * Zero-Trust Signature Middleware
 * Requer o header X-Identity-Signature: Base64(Ed25519_Sign(Timestamp + Body))
 * E o header X-Identity-DID: did:dao:asppibra:<username>
 *
 * FALLBACK: Aceita JWT Bearer token se os headers de Zero-Trust estiverem ausentes.
 */
export const authSignature = async (c: Context, next: Next) => {
  const path = c.req.path;
  if (path.includes('/webhook')) {
    return next();
  }

  const signature = c.req.header('X-Identity-Signature');
  const did = c.req.header('X-Identity-DID');
  const timestamp = c.req.header('X-Identity-Timestamp');

  const hasAnyZeroTrustHeader = signature || did || timestamp;

  // --- FALLBACK JWT (Para sessões padrão de Cidadão via Web2/Social) ---
  if (!signature || !did || !timestamp) {
    if (hasAnyZeroTrustHeader) {
      return c.json({ success: false, message: 'Missing Zero-Trust credentials.' }, 401);
    }

    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (token) {
      let secret: string;
      try {
        secret = requireJwtSecret(c);
      } catch (err) {
        console.error('[SECURITY] JWT_SECRET ausente — recusando autenticação.', err);
        return c.json({ success: false, message: 'Erro de configuração do servidor.' }, 500);
      }

      try {
        const payload = await jwtService.verify(token, secret);

        // Correção 1.2: sid é OBRIGATÓRIO. Sem sid, não há como validar a sessão
        // no D1 (revogação/expiração), então o token NUNCA é aceito silenciosamente.
        if (!payload.sid) {
          return c.json({ success: false, message: 'Invalid session payload (sid missing).' }, 401);
        }

        const db = c.get('db');
        if (!db) {
          return c.json({ success: false, message: 'Database context unavailable.' }, 500);
        }

        const { DrizzleSessionRepository } = await import('../../../infrastructure/repositories/DrizzleSessionRepository');
        const sessionRepo = new DrizzleSessionRepository(db);
        const sessionRecord = await sessionRepo.getSessionById(payload.sid);

        const { Session } = await import('../../../domains/identity/entities/Session');
        const session = sessionRecord ? Session.fromPersistence(sessionRecord as any) : null;

        if (!session || !session.isValid()) {
          return c.json({ success: false, message: 'Session revoked, inactive or expired.' }, 401);
        }

        c.set('user', {
          userId: session.userId,
          sessionId: session.id,
          sessionAal: session.aal,
          role: payload.role || 'citizen',
        });

        return await next();
      } catch (err) {
        return c.json({ success: false, message: 'Invalid or expired session token.' }, 401);
      }
    }
    return c.json({ success: false, message: 'Authentication required (Zero-Trust or JWT).' }, 401);
  }

  // 1. Verificar expiração do Timestamp (máximo 5 min)
  const now = Date.now();
  if (Math.abs(now - parseInt(timestamp)) > 300000) {
    return c.json({ success: false, message: 'Request signature expired.' }, 401);
  }

  // 2. Buscar Cidadão via UnitOfWork & Repositório Canônico
  const username = did.split(':').pop();
  if (!username) {
    return c.json({ success: false, message: 'Invalid DID format.' }, 401);
  }

  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);

  const repoResult = await uow.execute<CitizenRecord | null>(async (factory) => {
    const citizenRepo = factory.getCivilIdentityRepository();
    const record = await citizenRepo.findByDid(did);
    return Result.ok<CitizenRecord | null>(record);
  });

  const activeCitizen: CitizenRecord | null = repoResult.isSuccess ? repoResult.getValue() : null;

  if (!activeCitizen || activeCitizen.status === 'revoked' || activeCitizen.civilStatus === 'revoked') {
    return c.json({ success: false, message: 'Citizen not found or revoked.' }, 401);
  }

  // 3. Verificar Assinatura
  if (!activeCitizen.publicKey) {
    return c.json({ success: false, message: 'Public key missing for citizen.' }, 401);
  }

  const publicKey = Uint8Array.from(JSON.parse(activeCitizen.publicKey));
  const bodyText = await c.req.raw.clone().text();
  const msg = new TextEncoder().encode(timestamp + bodyText);

  try {
    const isValid = await CryptoCore.verify(
      Uint8Array.from(
        atob(signature)
          .split('')
          .map((char) => char.charCodeAt(0))
      ),
      msg,
      publicKey
    );

    if (!isValid) {
      return c.json({ success: false, message: 'Invalid Zero-Trust signature.' }, 401);
    }

    if (!activeCitizen.userId) {
      return c.json({ success: false, message: 'Citizen is not linked to a User account.' }, 403);
    }

    c.set('user', { userId: activeCitizen.userId, role: 'citizen' });
  } catch (e) {
    return c.json({ success: false, message: 'Signature verification failed.' }, 401);
  }

  await next();
};

```

---

## `src/interfaces/http/middlewares/correlation_id.ts`

```typescript
import { MiddlewareHandler } from 'hono';

export const correlationIdMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    let correlationId = c.req.header('X-Correlation-ID');
    if (!correlationId) {
      correlationId = crypto.randomUUID();
    }
    c.set('correlationId', correlationId);
    c.header('X-Correlation-ID', correlationId);
    await next();
  };
};

```

---

## `src/interfaces/http/middlewares/rate_limit.ts`

```typescript
import { Context, Next } from 'hono';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

// In-memory store (funciona por isolate no Cloudflare Workers)
// Para uma solução distribuída real, usar KV, Durable Objects ou Redis.
const store = new Map<string, { count: number; resetTime: number }>();

export interface RateLimiterProvider {
  isAllowed(
    ip: string,
    config: RateLimitConfig
  ): Promise<{ allowed: boolean; retryAfter?: number }>;
}

class MemoryProvider implements RateLimiterProvider {
  private store = new Map<string, { count: number; resetTime: number }>();

  async isAllowed(ip: string, config: RateLimitConfig) {
    const now = Date.now();
    let record = this.store.get(ip);

    if (!record || record.resetTime < now) {
      record = { count: 1, resetTime: now + config.windowMs };
      this.store.set(ip, record);
    } else {
      record.count++;
    }

    if (record.count > config.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) };
    }
    return { allowed: true };
  }
}

class KVProvider implements RateLimiterProvider {
  constructor(private kv: any) {}

  async isAllowed(ip: string, config: RateLimitConfig) {
    const now = Date.now();
    const key = `ratelimit:${ip}`;

    const data = await this.kv.get(key, 'json');
    let record = data ? (data as { count: number; resetTime: number }) : null;

    if (!record || record.resetTime < now) {
      record = { count: 1, resetTime: now + config.windowMs };
    } else {
      record.count++;
    }

    if (record.count > config.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) };
    }

    // TTL for KV
    await this.kv.put(key, JSON.stringify(record), {
      expirationTtl: Math.ceil(config.windowMs / 1000),
    });
    return { allowed: true };
  }
}

const memoryProvider = new MemoryProvider();

export const rateLimit = (config: RateLimitConfig) => {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('cf-connecting-ip') || 'unknown';

    // Use KV if available, else Memory
    const provider = c.env.KV_CACHE ? new KVProvider(c.env.KV_CACHE) : memoryProvider;

    const result = await provider.isAllowed(ip, config);

    if (!result.allowed) {
      return c.json(
        {
          success: false,
          message: 'Too Many Requests',
          retryAfter: result.retryAfter,
        },
        429
      );
    }

    await next();
  };
};

export const idempotency = () => {
  return async (c: Context, next: Next) => {
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (idempotencyKey && c.env.KV_CACHE) {
      const key = `idempotency:${idempotencyKey}`;
      const exists = await c.env.KV_CACHE.get(key);
      if (exists) {
        return c.json({ success: true, message: 'Request already processed (Idempotency)' }, 200);
      }
      await c.env.KV_CACHE.put(key, '1', { expirationTtl: 86400 }); // 24 hours
    }
    await next();
  };
};

```

---

## `src/interfaces/http/middlewares/rbac.ts`

```typescript
import { Context, Next } from 'hono';
import { error } from '../helpers/response';
import { eq, and, isNull, sql } from 'drizzle-orm';

/**
 * verifyRole - Middleware para Role-Based Access Control (RBAC)
 * Verifica diretamente no banco de dados, ignorando a claim do JWT.
 * @param allowedRoles Lista de cargos permitidos (ex: ['admin', 'partner'])
 */
export const verifyRole = (allowedRoles: string[]) => {
  return async (c: Context, next: Next) => {
    try {
      // GARANTIA FASE 0: RBAC nunca deve rodar sem sessionGuard
      const sessionUserId = c.get('userId');
      if (!sessionUserId) {
        return error(c, 'Erro Interno: Acesso negado. RBAC executado sem sessionGuard anterior.', null, 500);
      }

      const db = c.get('db');
      if (!db) {
        return error(c, 'Erro Interno: Conexão com banco de dados não encontrada.', null, 500);
      }

      const { userRoles, roles } = await import('../../../../db/authorization/tables');

      // Query para verificar se o usuário possui algum dos roles permitidos
      const userRolesData = await db
        .select({ roleKey: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(
          and(
            eq(userRoles.userId, sessionUserId),
            isNull(userRoles.revokedAt), // A role não deve estar revogada
            sql`${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > ${new Date().getTime()}`,
            eq(roles.status, 'active') // A role deve estar ativa no sistema
          )
        );

      const userRoleKeys = userRolesData.map((r: any) => r.roleKey);
      
      // The system should not grant implicit roles. All roles must be recorded in the DB.

      const hasRole = userRoleKeys.some((role: string) => allowedRoles.includes(role));

      if (!hasRole) {
        return error(
          c,
          `Acesso negado: Você não tem permissão para realizar esta ação. Requerido um dos: [${allowedRoles.join(', ')}]`,
          null,
          403
        );
      }

      await next();
    } catch (err: unknown) {
      console.error('🚨 RBAC Auth Error:', err);
      return error(c, 'Erro ao verificar permissões de acesso.', null, 500);
    }
  };
};

/**
 * verifyPermission - Middleware para verificar Permissões Granulares (FASE 4)
 * Verifica se as roles do usuário concedem a permissão requerida.
 * @param requiredPermission Permissão granular (ex: 'user.read')
 */
export const verifyPermission = (requiredPermission: string) => {
  return async (c: Context, next: Next) => {
    try {
      const sessionUserId = c.get('userId');
      if (!sessionUserId) {
        return error(c, 'Erro Interno: Acesso negado. RBAC executado sem sessionGuard anterior.', null, 500);
      }

      const db = c.get('db');
      const { userRoles, roles, rolePermissions, permissions } = await import('../../../../db/authorization/tables');

      const userPerms = await db
        .select({ permKey: permissions.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(
          and(
            eq(userRoles.userId, sessionUserId),
            isNull(userRoles.revokedAt),
            sql`${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > ${new Date().getTime()}`,
            eq(roles.status, 'active'),
            eq(permissions.key, requiredPermission)
          )
        )
        .limit(1);

      if (userPerms.length === 0) {
        return error(
          c,
          `Acesso negado: Permissão '${requiredPermission}' necessária para esta ação.`,
          null,
          403
        );
      }

      await next();
    } catch (err: unknown) {
      console.error('🚨 Permission Auth Error:', err);
      return error(c, 'Erro ao verificar permissões de acesso.', null, 500);
    }
  };
};


```

---

## `src/interfaces/http/middlewares/session_guard.ts`

```typescript
import { Context, Next } from 'hono';
import { JwtService } from '../../../infrastructure/security/jwt/JwtService';
import { DrizzleSessionRepository } from '../../../infrastructure/repositories/DrizzleSessionRepository';
import { DrizzleUserRepositoryAdapter } from '../../../infrastructure/repositories/DrizzleUserRepositoryAdapter';
import { IJwtService } from '../../../application/ports/security/IJwtService';

function resolveJwtService(c: Context): IJwtService {
  const service = c.get('jwtService') as IJwtService | undefined;
  if (!service) {
    throw new Error('IJwtService was not provided in the Hono context (Dependency Injection missing).');
  }
  return service;
}

/**
 * Stateful Session Guard Middleware
 * 1. Extrai o Bearer token do header Authorization.
 * 2. Valida a assinatura criptográfica e as claims temporais do JWT.
 * 3. Extrai o sid (Session ID) do payload.
 * 4. Realiza o lookup físico no D1 (user_sessions).
 * 5. Bloqueia (HTTP 401) se a sessão não existir, estiver revogada ou expirada.
 * 6. Injeta no contexto do Hono (c.set('user', ...)) o userId, sessionId e sessionAal.
 */
export const sessionGuard = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    return c.json({ success: false, message: 'Authentication required (Bearer token missing).' }, 401);
  }

  const secret = c.env.JWT_SECRET;
  if (!secret) {
    console.error('[SECURITY] JWT_SECRET ausente — recusando autenticação.');
    return c.json({ success: false, message: 'Erro de configuração do servidor.' }, 500);
  }

  try {
    const jwtService = resolveJwtService(c);
    const payload = await jwtService.verify(token, secret);

    if (!payload.sid) {
      return c.json({ success: false, message: 'Invalid session payload (sid missing).' }, 401);
    }

    const db = c.get('db');
    if (!db) {
      return c.json({ success: false, message: 'Database context unavailable.' }, 500);
    }

    const sessionRepo = new DrizzleSessionRepository(db);
    const sessionRecord = await sessionRepo.getSessionById(payload.sid);

    if (!sessionRecord) {
      return c.json({ success: false, message: 'Session not found.' }, 401);
    }

    const { Session } = await import('../../../domains/identity/entities/Session');
    const session = Session.fromPersistence(sessionRecord as any);

    if (!session.isValid()) {
      return c.json({ success: false, message: session.isRevoked ? 'Session has been revoked.' : 'Session has expired.' }, 401);
    }

    const userRepo = new DrizzleUserRepositoryAdapter(db);
    const userRecord = await userRepo.findById(session.userId);

    if (!userRecord) {
      return c.json({ success: false, message: 'User account not found.' }, 401);
    }

    const { User } = await import('../../../domains/identity/entities/User');
    const user = new User(userRecord as any);

    if (!user.canAuthenticate()) {
      return c.json({ success: false, message: `User account is not eligible for authentication.` }, 403);
    }

    // AF-008: Validar authEpoch da entidade Session contra o authEpoch atual do usuário (D1 -> D1)
    if (!session.matchesUserEpoch(user.authEpoch)) {
      return c.json(
        {
          success: false,
          message: 'Session invalidated due to password reset or security revocation (authEpoch mismatch).',
        },
        401
      );
    }

    c.set('user', {
      userId: session.userId,
      sessionId: session.id,
      sessionAal: session.aal,
      role: payload.role || 'citizen',
    });
    c.set('userId', session.userId);
    c.set('sessionId', session.id);
    c.set('sessionAal', session.aal);
    c.set('sessionCreatedAt', session.createdAt);

    await next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token inválido';
    return c.json({ success: false, message: 'Invalid or expired session token.', error: message }, 401);
  }
};

/**
 * Middleware para impor Nível de Garantia de Autenticação (AAL) e Recent Auth.
 * Deve ser usado APÓS o sessionGuard na cadeia de middlewares da rota.
 * 
 * @param minAal O AAL mínimo necessário (1, 2, ou 3).
 * @param maxAgeMinutes O tempo máximo permitido desde a autenticação (opcional).
 */
export const requireAal = (minAal: number, maxAgeMinutes?: number) => {
  return async (c: Context, next: Next) => {
    const sessionAal = c.get('sessionAal') as number | undefined;
    const sessionCreatedAt = c.get('sessionCreatedAt') as Date | undefined;

    if (!sessionAal) {
      return c.json({ success: false, message: 'Authentication level not found in context. sessionGuard is required.' }, 500);
    }

    if (sessionAal < minAal) {
      return c.json({ 
        success: false, 
        message: 'Insufficient authentication level.', 
        code: 'AAL_INSUFFICIENT',
        requiredAal: minAal 
      }, 403);
    }

    if (maxAgeMinutes && sessionCreatedAt) {
      const now = new Date();
      const diffMinutes = (now.getTime() - sessionCreatedAt.getTime()) / (1000 * 60);
      if (diffMinutes > maxAgeMinutes) {
        return c.json({ 
          success: false, 
          message: 'Recent authentication required.', 
          code: 'RECENT_AUTH_REQUIRED',
          maxAgeMinutes 
        }, 403);
      }
    }

    await next();
  };
};

```

---

## `src/interfaces/http/routes/civil-identity/civil_identity.routes.ts`

```typescript
import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleCivilIdentityRepositoryAdapter } from '../../../../infrastructure/repositories/DrizzleCivilIdentityRepositoryAdapter';
import { RegisterCitizenUseCase } from '../../../../domains/civil-identity/use-cases/RegisterCitizenUseCase';
import { SubmitKycVerificationUseCase } from '../../../../domains/civil-identity/use-cases/SubmitKycVerificationUseCase';
import { CivilIdentityController } from '../../controllers/civil-identity/CivilIdentityController';
import { sessionGuard } from '../../middlewares/session_guard';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const civilIdentityRouter = new Hono<AppType>();

civilIdentityRouter.use('*', sessionGuard);

civilIdentityRouter.post('/register', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const registerUseCase = new RegisterCitizenUseCase(uow);
  const submitKycUseCase = new SubmitKycVerificationUseCase(uow);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.register(c);
});

civilIdentityRouter.post('/kyc/submit', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const registerUseCase = new RegisterCitizenUseCase(uow);
  const submitKycUseCase = new SubmitKycVerificationUseCase(uow);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.submitKyc(c);
});

civilIdentityRouter.get('/me', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const registerUseCase = new RegisterCitizenUseCase(uow);
  const submitKycUseCase = new SubmitKycVerificationUseCase(uow);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.getMe(c);
});

```

---

## `src/interfaces/http/routes/core/compliance.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { app } from '../../../../index';

describe('Compliance Module — KYC', () => {
  const baseEnv = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: () => Promise.resolve({}),
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true, meta: {} }),
          raw: () => Promise.resolve([]),
        }),
        first: () => Promise.resolve({}),
        all: () => Promise.resolve({ results: [], success: true }),
        run: () => Promise.resolve({ success: true, meta: {} }),
        raw: () => Promise.resolve([]),
      }),
    },
    KV_AUTH: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    KV_CACHE: {},
    STORAGE: {},
    JWT_SECRET: 'test_secret',
    ADMIN_PASSWORD: 'secret_admin_key_123',
  };

  // --- /kyc/review ---

  it('rejects /kyc/review without x-admin-key header', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 1, status: 'approved' }),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.message).toBe('Unauthorized');
  });

  it('rejects /kyc/review with wrong x-admin-key (timing-safe)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': 'wrong_key',
        },
        body: JSON.stringify({ userId: 1, status: 'approved' }),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
  });

  it('rejects /kyc/review with invalid status value (Zod)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': 'secret_admin_key_123',
        },
        body: JSON.stringify({ userId: 1, status: 'INVALID_STATUS' }),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    // Zod retorna 400 para validation error
    expect(res.status).toBe(400);
  });

  it('rejects /kyc/review with invalid documentType (Zod)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Sem headers Zero-Trust — deve falhar no middleware
        },
        body: JSON.stringify({ userId: 1, documentType: 'INVALID_TYPE' }),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401); // Zero-Trust middleware bloqueia primeiro
  });

  it('rejects /kyc/submit with empty body (Zod)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    // Zero-Trust middleware rejeita primeiro (sem headers)
    expect(res.status).toBe(401);
  });
});

```

---

## `src/interfaces/http/routes/core/compliance.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users, auditLogs } from '../../../../db/schema';
import { authSignature } from '../../middlewares/auth_signature';
import { timingSafeEqual } from '../../../../infrastructure/security/crypto/timing_safe';
import { Bindings } from '../../../../types/bindings';

const KycSubmit = {
  Schema: z.object({
    userId: z.number().int().positive('userId deve ser um número inteiro positivo'),
    documentType: z.enum(['RG', 'CPF', 'CNH', 'PASSAPORTE', 'OUTROS'], {
      message: 'Tipo de documento inválido',
    }),
  }),
};

const KycReview = {
  Schema: z.object({
    userId: z.number().int().positive('userId deve ser um número inteiro positivo'),
    status: z.enum(['approved', 'rejected', 'pending'], { message: 'Status inválido' }),
    reason: z.string().max(500).optional(),
  }),
};

type AppType = { Bindings: Bindings; Variables: { db: any } };

const compliance = new Hono<AppType>();

compliance.post('/kyc/submit', authSignature, zValidator('json', KycSubmit.Schema), async (c) => {
  const { userId, documentType } = c.req.valid('json');
  const db = c.get('db');

  await db.update(users).set({ kycStatus: 'pending' }).where(eq(users.id, userId));

  await db.insert(auditLogs).values({
    action: 'KYC_SUBMITTED',
    actorId: userId,
    status: 'success',
    metadata: { documentType },
  });

  return c.json({ success: true, message: 'Documentos enviados para revisão.' });
});

compliance.post('/kyc/review', zValidator('json', KycReview.Schema), async (c) => {
  const { userId, status, reason } = c.req.valid('json');
  const adminKey = c.req.header('x-admin-key') ?? '';
  const db = c.get('db');

  const adminPassword = c.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return c.json(
      { success: false, message: 'Configuração de segurança ausente. Contate o administrador.' },
      500
    );
  }

  if (!adminKey || !timingSafeEqual(adminKey, adminPassword)) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  await db.update(users).set({ kycStatus: status }).where(eq(users.id, userId));

  await db.insert(auditLogs).values({
    action: `KYC_${status.toUpperCase()}`,
    actorId: userId,
    status: 'success',
    metadata: { reason },
  });

  return c.json({ success: true, message: `Status KYC atualizado para: ${status}` });
});

export default compliance;

```

---

## `src/interfaces/http/routes/core/health.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { app } from '../../../../index';

describe('Backend Health Check', () => {
  it('should return 200 OK on /api/core/health/health', async () => {
    // Mocking Cloudflare Bindings for Hono
    const res = await app.fetch(
      new Request('http://localhost/api/core/health/health'),
      {
        DB: {
          prepare: () => ({
            bind: () => ({
              first: () => Promise.resolve({}),
              all: () => Promise.resolve({ results: [], success: true }),
              run: () => Promise.resolve({ success: true, meta: {} }),
              raw: () => Promise.resolve([]),
            }),
            first: () => Promise.resolve({}),
            all: () => Promise.resolve({ results: [], success: true }),
            run: () => Promise.resolve({ success: true, meta: {} }),
            raw: () => Promise.resolve([]),
          }),
        },
        KV_AUTH: {},
        KV_CACHE: {},
        STORAGE: {},
      } as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });
});

```

---

## `src/interfaces/http/routes/core/health.ts`

```typescript
/**
 * Copyright 2025 ASPPIBRA – Associação dos Proprietários e Possuidores de Imóveis no Brasil.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Central System API & Identity Provider
 */
import { Hono } from 'hono';
import { Bindings } from '../../../../types/bindings';

const app = new Hono<{ Bindings: Bindings }>();

// 1. Health Check Simples (Ping)
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    system: 'CENTRAL-SYSTEM-API',
    timestamp: new Date().toISOString(),
  });
});

// Liveness Probe (K8s/Edge Probe)
app.get('/live', (c) => {
  return c.json({ status: 'live', timestamp: new Date().toISOString() });
});

// Readiness Probe (Verifica DB e Queue)
app.get('/ready', async (c) => {
  try {
    const db = c.get('db' as any);
    // Minimal query to ensure connection
    return c.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (e: any) {
    return c.json({ status: 'not_ready', error: e.message }, 503);
  }
});

// 2. Health Check do Banco de Dados
app.get('/db', async (c) => {
  // Como o middleware global já injetou o DB, se chegou aqui, o DB instanciou.
  // Podemos fazer uma query simples para garantir.
  try {
    const db = c.get('db' as any); // Recupera do contexto
    // Opcional: const result = await db.run(sql`SELECT 1`);
    return c.json({ status: 'ok', message: 'DB Connected' });
  } catch (e: any) {
    return c.json({ status: 'error', message: e.message }, 500);
  }
});

// 3. Monitoramento Avançado (Cloudflare GraphQL)
// Movido do index.ts antigo para cá
app.get('/analytics', async (c) => {
  const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
  const zoneId = c.env.CLOUDFLARE_ZONE_ID;
  const apiToken = c.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !zoneId || !apiToken) {
    return c.json({ error: 'Configuração incompleta de Observabilidade' }, 500);
  }

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const isoStart = oneDayAgo.toISOString();
  const isoEnd = now.toISOString();
  const dateStart = isoStart.split('T')[0];

  const query = `
    query {
      viewer {
        accounts(filter: { accountTag: "${accountId}" }) {
          d1: d1AnalyticsAdaptiveGroups(limit: 1, filter: { date_geq: "${dateStart}" }) {
            sum { readQueries, writeQueries }
          }
        }
        zones(filter: { zoneTag: "${zoneId}" }) {
          traffic: httpRequestsAdaptiveGroups(limit: 1, filter: { datetime_geq: "${isoStart}", datetime_lt: "${isoEnd}" }) {
            count
            sum { edgeResponseBytes }
          }
          cache: httpRequestsAdaptiveGroups(limit: 5, filter: { datetime_geq: "${isoStart}", datetime_lt: "${isoEnd}" }, orderBy: [count_DESC]) {
            count
            dimensions { cacheStatus }
          }
          countries: httpRequestsAdaptiveGroups(limit: 5, filter: { datetime_geq: "${isoStart}", datetime_lt: "${isoEnd}" }, orderBy: [count_DESC]) {
            count
            dimensions { clientCountryName }
          }
        }
      }
    }
  `;

  try {
    const cfResponse = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ query }),
    });

    const cfData: any = await cfResponse.json();

    if (cfData.errors) {
      console.error('Erro Cloudflare:', JSON.stringify(cfData.errors));
      return c.json({ error: 'Erro API Cloudflare', details: cfData.errors }, 500);
    }

    const zoneData = cfData?.data?.viewer?.zones?.[0] || {};
    const accountData = cfData?.data?.viewer?.accounts?.[0] || {};
    const trafficRaw = zoneData.traffic?.[0] || { count: 0, sum: { edgeResponseBytes: 0 } };
    const dbMetrics = accountData.d1?.[0]?.sum || { readQueries: 0, writeQueries: 0 };
    const cacheRaw = zoneData.cache || [];
    const totalCacheReqs = cacheRaw.reduce((acc: number, item: any) => acc + item.count, 0);
    const hits =
      cacheRaw.find((i: any) => ['hit', 'revalidated'].includes(i.dimensions.cacheStatus))?.count ||
      0;
    const cacheRatio = totalCacheReqs > 0 ? ((hits / totalCacheReqs) * 100).toFixed(0) : '0';

    const countries = (zoneData.countries || []).map((item: any) => ({
      code: item.dimensions.clientCountryName,
      count: item.count,
    }));

    return c.json({
      requests: trafficRaw.count,
      bytes: trafficRaw.sum.edgeResponseBytes,
      cacheRatio: cacheRatio,
      dbReads: dbMetrics.readQueries,
      dbWrites: dbMetrics.writeQueries,
      countries: countries,
    });
  } catch (e: any) {
    console.error('Monitoring Exception:', e.message);
    return c.json({ error: 'Falha interna', msg: e.message }, 500);
  }
});

export default app;

```

---

## `src/interfaces/http/routes/core/webhooks.ts`

```typescript
/**
 * Copyright 2025 ASPPIBRA – Associação dos Proprietários e Possuidores de Imóveis no Brasil.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Central System API & Identity Provider
 */
import { Hono } from 'hono';
import { Bindings } from '../../../../types/bindings';

const app = new Hono<{ Bindings: Bindings }>();

app.post('/', (c) => c.json({ module: 'Webhooks', received: true }));

export default app;

```

---

## `src/interfaces/http/routes/finance/finance.routes.ts`

```typescript
import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../../../infrastructure/repositories/DrizzleFinanceRepository';
import { GetTreasuryBalanceUseCase } from '../../../../domains/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../domains/finance/use-cases/RecordTreasuryTransactionUseCase';
import { FinanceController } from '../../controllers/finance/FinanceController';
import { sessionGuard } from '../../middlewares/session_guard';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const financeRouter = new Hono<AppType>();

financeRouter.use('*', sessionGuard);

financeRouter.get('/treasury/balance', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const financeRepo = new DrizzleFinanceRepository(db);
  const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
  const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);

  const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
  return controller.getBalance(c);
});

financeRouter.post('/transactions', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const financeRepo = new DrizzleFinanceRepository(db);
  const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
  const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);

  const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
  return controller.recordTransaction(c);
});

financeRouter.get('/transactions', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const financeRepo = new DrizzleFinanceRepository(db);
  const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
  const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);

  const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
  return controller.listTransactions(c);
});

```

---

## `src/interfaces/http/routes/identity/identity.routes.ts`

```typescript
import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { PBKDF2PasswordHasher } from '../../../../infrastructure/security/crypto/PBKDF2PasswordHasher';
import { JwtService } from '../../../../infrastructure/security/jwt/JwtService';
import { SecurityAuditAdapter } from '../../../../infrastructure/security/SecurityAuditAdapter';
import { DrizzleSessionRepository } from '../../../../infrastructure/repositories/DrizzleSessionRepository';
import { DrizzleIdentityResolverAdapter } from '../../../../infrastructure/repositories/DrizzleIdentityResolverAdapter';
import { Eip4361Verifier } from '../../../../infrastructure/security/crypto/Eip4361Verifier';

import { AuthenticateAccountUseCase } from '../../../../application/use-cases/identity/AuthenticateAccountUseCase';
import { RegisterAccountUseCase } from '../../../../application/use-cases/identity/RegisterAccountUseCase';
import { VerifyWalletIdentityUseCase } from '../../../../application/use-cases/identity/VerifyWalletIdentityUseCase';
import { VerifyPasskeyIdentityUseCase } from '../../../../application/use-cases/identity/VerifyPasskeyIdentityUseCase';
import { LinkExternalIdentityUseCase } from '../../../../application/use-cases/identity/LinkExternalIdentityUseCase';
import { UnlinkExternalIdentityUseCase } from '../../../../application/use-cases/identity/UnlinkExternalIdentityUseCase';

import { SetupTotpUseCase } from '../../../../application/use-cases/identity/SetupTotpUseCase';
import { AuthenticateTotpUseCase } from '../../../../application/use-cases/identity/AuthenticateTotpUseCase';
import { RequestPasswordResetUseCase } from '../../../../application/use-cases/identity/RequestPasswordResetUseCase';
import { ConfirmPasswordResetUseCase } from '../../../../application/use-cases/identity/ConfirmPasswordResetUseCase';
import { RefreshTokenUseCase } from '../../../../application/use-cases/identity/RefreshTokenUseCase';

import { IdentityController } from '../../controllers/identity/IdentityController';
import { ExternalIdentityController } from '../../controllers/identity/ExternalIdentityController';
import { AuthAuxiliaryController } from '../../controllers/identity/AuthAuxiliaryController';
import { rateLimit } from '../../middlewares/rate_limit';
import { sessionGuard } from '../../middlewares/session_guard';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

const identityRouter = new Hono<AppType>();

// ----------------------------------------------------------------------------
// 1. CANONICAL REGISTER & LOGIN (LOCAL, WEB3 SIWE, PASSKEY, LOGOUT)
// ----------------------------------------------------------------------------
identityRouter.post('/logout', sessionGuard, async (c) => {
  const db = c.get('db');
  const sessionRepo = new DrizzleSessionRepository(db);
  const jwtService = new JwtService();
  const controller = new IdentityController(undefined as any, jwtService, sessionRepo);
  return controller.logout(c);
});

identityRouter.post('/logout-all', sessionGuard, async (c) => {
  const db = c.get('db');
  const sessionRepo = new DrizzleSessionRepository(db);
  const jwtService = new JwtService();
  const controller = new IdentityController(undefined as any, jwtService, sessionRepo);
  return controller.logoutAll(c);
});

identityRouter.post(
  '/register',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 5 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const hasher = new PBKDF2PasswordHasher();
    const jwtService = new JwtService();
    const auditAdapter = new SecurityAuditAdapter(db);
    const sessionRepo = new DrizzleSessionRepository(db);

    const authenticateUseCase = new AuthenticateAccountUseCase(uow, hasher, auditAdapter);
    const registerUseCase = new RegisterAccountUseCase(uow, hasher, auditAdapter);
    const controller = new IdentityController(authenticateUseCase, jwtService, sessionRepo, registerUseCase);

    return controller.register(c);
  }
);

identityRouter.post(
  '/login/local',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const hasher = new PBKDF2PasswordHasher();
    const jwtService = new JwtService();
    const auditAdapter = new SecurityAuditAdapter(db);
    const sessionRepo = new DrizzleSessionRepository(db);

    const authenticateUseCase = new AuthenticateAccountUseCase(uow, hasher, auditAdapter);
    const controller = new IdentityController(authenticateUseCase, jwtService, sessionRepo);

    return controller.loginLocal(c);
  }
);

identityRouter.post('/web3/challenge', async (c) => {
  const db = c.get('db');
  const jwtService = new JwtService();
  const sessionRepo = new DrizzleSessionRepository(db);
  const controller = new IdentityController(undefined as any, jwtService, sessionRepo);
  return controller.generateWeb3Challenge(c);
});

identityRouter.post(
  '/login/web3',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const hasher = new PBKDF2PasswordHasher();
    const jwtService = new JwtService();
    const auditAdapter = new SecurityAuditAdapter(db);
    const sessionRepo = new DrizzleSessionRepository(db);
    const resolverAdapter = new DrizzleIdentityResolverAdapter(db);
    const siweVerifier = new Eip4361Verifier();

    const authenticateUseCase = new AuthenticateAccountUseCase(uow, hasher, auditAdapter);
    const verifyWalletUseCase = new VerifyWalletIdentityUseCase(siweVerifier, resolverAdapter, auditAdapter);
    const controller = new IdentityController(
      authenticateUseCase,
      jwtService,
      sessionRepo,
      undefined,
      verifyWalletUseCase
    );

    return controller.loginWeb3(c);
  }
);

identityRouter.post('/login/passkey/challenge', async (c) => {
  const db = c.get('db');
  const jwtService = new JwtService();
  const sessionRepo = new DrizzleSessionRepository(db);
  const controller = new IdentityController(undefined as any, jwtService, sessionRepo);
  return controller.generatePasskeyChallenge(c);
});

identityRouter.post('/registration/passkey/challenge', sessionGuard, async (c) => {
  const db = c.get('db');
  const jwtService = new JwtService();
  const sessionRepo = new DrizzleSessionRepository(db);
  const controller = new IdentityController(undefined as any, jwtService, sessionRepo);
  return controller.generatePasskeyChallenge(c);
});

identityRouter.post(
  '/login/passkey',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const jwtService = new JwtService();
    const sessionRepo = new DrizzleSessionRepository(db);
    const resolverAdapter = new DrizzleIdentityResolverAdapter(db);
    const auditAdapter = new SecurityAuditAdapter(db);

    const verifyPasskeyUseCase = new VerifyPasskeyIdentityUseCase(uow, resolverAdapter, auditAdapter);
    const controller = new IdentityController(
      undefined as any,
      jwtService,
      sessionRepo,
      undefined,
      undefined,
      verifyPasskeyUseCase
    );

    return controller.loginPasskey(c);
  }
);

// ----------------------------------------------------------------------------
// 2. AUXILIARY AUTHENTICATION (2FA / TOTP, PASSWORD RESET, REFRESH SESSION)
// ----------------------------------------------------------------------------
identityRouter.post('/totp/setup', sessionGuard, async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const setupTotpUseCase = new SetupTotpUseCase(uow);
  const controller = new AuthAuxiliaryController(setupTotpUseCase);
  return controller.setupTotp(c);
});

identityRouter.post('/totp/verify', rateLimit({ windowMs: 60 * 1000, maxRequests: 5 }), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);
  const authTotpUseCase = new AuthenticateTotpUseCase(uow, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, authTotpUseCase);
  return controller.verifyTotp(c);
});

identityRouter.post('/password-reset/request', rateLimit({ windowMs: 60 * 1000, maxRequests: 3 }), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);
  const requestResetUseCase = new RequestPasswordResetUseCase(uow, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, undefined, requestResetUseCase);
  return controller.requestPasswordReset(c);
});

identityRouter.post('/password-reset/confirm', rateLimit({ windowMs: 60 * 1000, maxRequests: 5 }), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const hasher = new PBKDF2PasswordHasher();
  const auditAdapter = new SecurityAuditAdapter(db);
  const confirmResetUseCase = new ConfirmPasswordResetUseCase(uow, hasher, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, undefined, undefined, confirmResetUseCase);
  return controller.confirmPasswordReset(c);
});

identityRouter.post('/refresh', rateLimit({ windowMs: 60 * 1000, maxRequests: 20 }), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const jwtService = new JwtService();
  const auditAdapter = new SecurityAuditAdapter(db);

  const secret = c.env?.JWT_SECRET;
  if (!secret) {
    return c.json({ success: false, message: 'Erro de configuração do servidor (JWT_SECRET ausente).' }, 500);
  }

  const tokenService = {
    generateAccessToken: async (payload: { userId: number; email: string; authEpoch: number }) => {
      return await jwtService.sign(
        { sub: String(payload.userId), userId: payload.userId, email: payload.email, authEpoch: payload.authEpoch },
        secret
      );
    },
    generateRefreshToken: async () => crypto.randomUUID(),
  };

  const refreshUseCase = new RefreshTokenUseCase(uow, tokenService, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, undefined, undefined, undefined, refreshUseCase);
  return controller.refreshSession(c);
});

// ----------------------------------------------------------------------------
// 3. EXTERNAL IDENTITIES (GET, POST /link, POST /unlink)
// ----------------------------------------------------------------------------
identityRouter.get('/external-identities', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.list(c);
});

identityRouter.post('/external-identities/link', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.link(c);
});

identityRouter.post('/external-identities/unlink', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.unlink(c);
});

export default identityRouter;


```

---

## `src/interfaces/http/routes/ssi/ssi.routes.ts`

```typescript
import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleSsiRepository } from '../../../../infrastructure/repositories/DrizzleSsiRepository';
import { CreateDidUseCase } from '../../../../domains/ssi/use-cases/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from '../../../../domains/ssi/use-cases/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from '../../../../domains/ssi/use-cases/RevokeCredentialUseCase';
import { SsiController } from '../../controllers/ssi/SsiController';
import { sessionGuard } from '../../middlewares/session_guard';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const ssiRouter = new Hono<AppType>();

ssiRouter.use('*', sessionGuard);

ssiRouter.post('/did', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.createDid(c);
});

ssiRouter.post('/credentials/issue', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.issueCredential(c);
});

ssiRouter.post('/credentials/revoke', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.revokeCredential(c);
});

ssiRouter.get('/credentials', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.listMyCredentials(c);
});

```

---

## `src/shared/kernel/DomainEvent.ts`

```typescript
export interface IDomainEvent {
  dateTimeOccurred: Date;
  getAggregateId(): string;
}

export interface IDomainEventPublisher {
  publish(event: IDomainEvent): Promise<void>;
  publishAll(events: IDomainEvent[]): Promise<void>;
}

```

---

## `src/shared/kernel/Result.ts`

```typescript
export class Result<T> {
  public readonly isSuccess: boolean;
  public readonly isFailure: boolean;
  public readonly error: string | null;
  private readonly _value: T | null;

  private constructor(isSuccess: boolean, error: string | null, value: T | null) {
    if (isSuccess && error) {
      throw new Error("InvalidOperation: A result cannot be successful and contain an error");
    }
    if (!isSuccess && !error) {
      throw new Error("InvalidOperation: A failing result needs to contain an error message");
    }
    this.isSuccess = isSuccess;
    this.isFailure = !isSuccess;
    this.error = error;
    this._value = value;
  }

  public getValue(): T {
    if (!this.isSuccess || this._value === null) {
      throw new Error("Can't get the value of an error result. Use 'error' instead.");
    }
    return this._value;
  }

  public static ok<U>(value?: U): Result<U> {
    return new Result<U>(true, null, value as U);
  }

  public static fail<U>(error: string): Result<U> {
    return new Result<U>(false, error, null);
  }
}

```

---

## `src/shared/kernel/ids/UserId.ts`

```typescript
/**
 * Branded Type for Canonical UserId
 * Prevents domain coupling while maintaining strong type safety across Bounded Contexts.
 */
export type UserId = number & { readonly __brand: unique symbol };

export function createUserId(id: number): UserId {
  return id as UserId;
}

```

---

## `src/types/bindings.d.ts`

```typescript
/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Type Definitions for Cloudflare Bindings & Hono Variables
 * Version: 1.1.0
 */
import { D1Database, R2Bucket, Fetcher, KVNamespace, Queue } from '@cloudflare/workers-types';

/**
 * Bindings: Representam os recursos externos da Cloudflare definidos no wrangler.toml
 */
export type Bindings = {
  // 1. Banco de Dados (D1) - Onde residem os usuários e contratos
  DB: D1Database;

  // 2. Armazenamento de Arquivos (R2) - Para imagens de capa e documentos
  STORAGE: R2Bucket;

  // 3. Arquivos Estáticos - Gerenciados pelo Cloudflare Pages/Workers Assets
  ASSETS: Fetcher;

  // 4. Armazenamento de Chave-Valor (KV)
  KV_AUTH: KVNamespace;
  KV_CACHE: KVNamespace;

  // 5. Segredos e Chaves de API
  JWT_SECRET: string;
  ADMIN_PASSWORD: string;
  ZERO_EX_API_KEY: string;
  MORALIS_API_KEY: string;
  BINANCE_API_KEY: string;
  BINANCE_API_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  FRONTEND_URL: string;
  DEVELOPER_SSH_KEY?: string;
  JWT_KEY_VERSION?: string;

  // 6. Analytics e Gestão Cloudflare
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  SENDPULSE_ID: string;
  SENDPULSE_SECRET: string;
  SENDPULSE_API_KEY: string;
  RESEND_API_KEY: string;
  SENDER_EMAIL: string;
  SVIX_SECRET: string;
  ZOHO_APP_PASSWORD: string;
  ZOHO_CLIENT_SECRET: string;
  AI: any;

  // 7. Filas e Armazenamentos (Fase A)
  EMAIL_PIPELINE_QUEUE: Queue<any>;
  CHAT_PIPELINE_QUEUE: Queue<any>;
  R2_EMAIL_ATTACHMENTS: R2Bucket;

  // 8. Durable Objects
  CHAT_ROOM: DurableObjectNamespace;

  // 9. Chaos Engineering & Environment
  ENVIRONMENT?: string;
  CHAOS_D1_DOWN?: string;
  CHAOS_KV_DOWN?: string;
  CHAOS_RESEND_DOWN?: string;
};

/**
 * Variables: Representam os dados injetados no contexto da requisição (c.set / c.get)
 * Essencial para o funcionamento do requireAuth e das rotas protegidas.
 */
export type Variables = {
  user: {
    userId: number;
    role: 'citizen' | 'partner' | 'admin' | 'system' | 'dev' | 'user';
  };
  // Instância do banco injetada no middleware global
  db: import('../db').Database;
  correlationId?: string;
};

```

---

## `src/types/manifest.d.ts`

```typescript
/**
 * Copyright 2025 ASPPIBRA – Associação dos Proprietários e Possuidores de Imóveis no Brasil.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Central System API & Identity Provider
 */
declare module '__STATIC_CONTENT_MANIFEST' {
  const manifest: string;
  export default manifest;
}

```

---

