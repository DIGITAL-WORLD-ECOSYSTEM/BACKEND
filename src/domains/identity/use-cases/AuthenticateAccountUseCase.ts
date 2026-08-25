import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { IPasswordHasher } from '../../../application/ports/security/IPasswordHasher';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';

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

// In-memory brute-force tracker for failed login attempts (keyed by userId)
const failedAttemptsMap = new Map<number, { count: number; lastAttempt: Date }>();
const MAX_FAILED_ATTEMPTS = 5;

export class AuthenticateAccountUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly hasher: IPasswordHasher,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: AuthenticateAccountDTO): Promise<Result<AuthenticateAccountResult>> {
    if (!dto.email || !dto.password) {
      return Result.fail<AuthenticateAccountResult>('Email e senha são obrigatórios.');
    }

    const emailNormalized = dto.email.trim().toLowerCase();

    return await this.uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository();
      const authRepo = factory.getAuthenticationRepository();

      const user = await userRepo.findByEmail(emailNormalized);
      if (!user) {
        return Result.fail<AuthenticateAccountResult>('Credenciais inválidas.');
      }

      // 1. Verificar se a conta está bloqueada ou suspensa
      if (user.status === 'locked' || user.status === 'suspended') {
        return Result.fail<AuthenticateAccountResult>(
          'Conta bloqueada por razões de segurança. Solicite a redefinição de senha para desbloquear.'
        );
      }

      // 2. Buscar credencial de senha
      const credential = await authRepo.findPasswordCredentialByUserId(user.id);
      if (!credential) {
        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'identity_login_failed',
            userId: user.id,
            metadata: { email: emailNormalized, reason: 'Missing credential' },
          });
        }
        return Result.fail<AuthenticateAccountResult>('Credenciais inválidas.');
      }

      // 3. Verificar senha
      const isPasswordValid = await this.hasher.verify(dto.password, credential.passwordHash);
      if (!isPasswordValid) {
        const attempt = failedAttemptsMap.get(user.id) || { count: 0, lastAttempt: new Date() };
        attempt.count += 1;
        attempt.lastAttempt = new Date();
        failedAttemptsMap.set(user.id, attempt);

        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'identity_login_failed',
            userId: user.id,
            metadata: { email: emailNormalized, reason: 'Invalid password', attemptCount: attempt.count },
          });
        }

        // Se exceder o limite de 5 tentativas incorretas, bloqueia a conta
        if (attempt.count >= MAX_FAILED_ATTEMPTS) {
          await userRepo.updateStatus(user.id, 'locked');
          return Result.fail<AuthenticateAccountResult>(
            'Conta bloqueada devido a 5 tentativas incorretas de senha. Redefina sua senha.'
          );
        }

        return Result.fail<AuthenticateAccountResult>('Credenciais inválidas.');
      }

      // Resetar tentativas em caso de sucesso
      failedAttemptsMap.delete(user.id);

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'authentication_succeeded',
          userId: user.id,
          metadata: { email: user.email },
        });
      }

      return Result.ok<AuthenticateAccountResult>({
        userId: user.id,
        email: user.email,
        publicId: user.publicId,
        status: user.status,
      });
    });
  }
}

