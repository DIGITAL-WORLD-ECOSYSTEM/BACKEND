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

      const isPasswordValid = await this.hasher.verify(dto.password, credential.passwordHash);
      if (!isPasswordValid) {
        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'identity_login_failed',
            userId: user.id,
            metadata: { email: emailNormalized, reason: 'Invalid password' },
          });
        }
        return Result.fail<AuthenticateAccountResult>('Credenciais inválidas.');
      }

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
