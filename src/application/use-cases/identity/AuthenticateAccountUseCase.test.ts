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
      hash: vi.fn().mockResolvedValue('dummy_hash'),
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
