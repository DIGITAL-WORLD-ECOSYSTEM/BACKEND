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
