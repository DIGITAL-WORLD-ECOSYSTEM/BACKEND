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
        email: newUser.email,
        status: newUser.status,
        createdAt: newUser.createdAt,
      });
    });
  }
}
