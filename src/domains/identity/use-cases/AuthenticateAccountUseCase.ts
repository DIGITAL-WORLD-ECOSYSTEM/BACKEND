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

      const user = await userRepo.findByEmail(emailNormalized);

      if (!user) {
        // Achado adicional (B): equaliza o tempo de resposta executando um
        // hash "isca" com o mesmo custo computacional do hasher real, para
        // que "usuário inexistente" e "senha incorreta" fiquem indistinguíveis
        // por tempo de resposta.
        await this.hasher.verify(dto.password, DUMMY_PASSWORD_HASH).catch(() => undefined);
        return Result.fail<AuthenticateAccountResult>(GENERIC_AUTH_FAILURE_MESSAGE);
      }

      // 1. Conta bloqueada ou suspensa — mesma mensagem genérica (item 3.1).
      // Antes, esta branch dizia explicitamente "Conta bloqueada...", o que
      // permitia a um atacante confirmar a existência da conta ao bombardear
      // e-mails e observar qual resposta difere. Agora é idêntica à de
      // credenciais inválidas.
      if (user.status === 'locked' || user.status === 'suspended') {
        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'identity_login_blocked',
            userId: user.id,
            metadata: { email: emailNormalized, reason: `Account status: ${user.status}` },
          });
        }
        return Result.fail<AuthenticateAccountResult>(GENERIC_AUTH_FAILURE_MESSAGE);
      }

      // 2. Buscar credencial de senha
      const credential = await authRepo.findPasswordCredentialByUserId(user.id);
      if (!credential) {
        // Equaliza tempo de resposta com hash isca (mesmo motivo do caso B acima).
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

        // Se exceder o limite de 5 tentativas incorretas, bloqueia a conta,
        // mas a resposta HTTP continua sendo a mesma mensagem genérica
        // (item 3.1) — o bloqueio é registrado internamente e comunicado
        // apenas via fluxo de "esqueci minha senha", nunca no corpo do 401.
        if (attempt.count >= MAX_FAILED_ATTEMPTS) {
          await userRepo.updateStatus(user.id, 'locked');
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

      // Sucesso: resetar tentativas
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
