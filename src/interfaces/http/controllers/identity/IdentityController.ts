import { Context } from 'hono';
import { AuthenticateAccountUseCase } from '../../../../domains/identity/use-cases/AuthenticateAccountUseCase';
import { RegisterAccountUseCase } from '../../../../domains/identity/use-cases/RegisterAccountUseCase';
import { IJwtService } from '../../../../application/ports/security/IJwtService';
import { ISessionRepository } from '../../../../application/ports/output/ISessionRepository';
import { error, success } from '../../helpers/response';

export class IdentityController {
  constructor(
    private readonly authenticateUseCase: AuthenticateAccountUseCase,
    private readonly jwtService: IJwtService,
    private readonly sessionRepo: ISessionRepository,
    private readonly registerUseCase?: RegisterAccountUseCase
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
      const jwtSecret = c.env?.JWT_SECRET || 'asppibra-secret-key-change-in-production';

      const sessionId = crypto.randomUUID();
      const jti = crypto.randomUUID();
      const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
      const userAgent = c.req.header('user-agent') || 'unknown';
      const createdAt = new Date();
      const expiresAt = new Date(Date.now() + 86400 * 1000);

      await this.sessionRepo.createSession({
        id: sessionId,
        userId: user.userId,
        jti,
        ip,
        userAgent,
        refreshTokenHash: crypto.randomUUID(),
        aal: 1,
        authEpoch: 1,
        createdAt,
        expiresAt,
      });

      const token = await this.jwtService.sign(
        {
          sub: user.publicId || String(user.userId),
          userId: user.userId,
          email: user.email,
          publicId: user.publicId,
          sid: sessionId,
          jti,
          aal: 1,
        },
        jwtSecret
      );

      return success(c, 'Login realizado com sucesso', {
        token,
        user: {
          id: user.userId,
          email: user.email,
          publicId: user.publicId,
          status: user.status,
        },
        session: {
          id: sessionId,
          aal: 1,
          expiresAt,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno no servidor ao processar autenticação', message, 500);
    }
  }
}
