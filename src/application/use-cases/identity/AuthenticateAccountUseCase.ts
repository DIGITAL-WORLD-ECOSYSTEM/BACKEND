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

export class AuthenticateAccountUseCase {
  private dummyPasswordHashPromise: Promise<string> | null = null;

  constructor(
    private readonly uow: IUnitOfWork,
    private readonly hasher: IPasswordHasher,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  private getDummyHash(): Promise<string> {
    if (!this.dummyPasswordHashPromise) {
      this.dummyPasswordHashPromise = this.hasher.hash('dummy-password-fixa');
    }
    return this.dummyPasswordHashPromise;
  }

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
        const dummyHash = await this.getDummyHash();
        await this.hasher.verify(dto.password, dummyHash).catch(() => undefined);
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
        const dummyHash = await this.getDummyHash();
        await this.hasher.verify(dto.password, dummyHash).catch(() => undefined);
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
