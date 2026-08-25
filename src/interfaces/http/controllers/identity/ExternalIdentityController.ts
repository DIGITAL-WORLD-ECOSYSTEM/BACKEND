import { Context } from 'hono';
import { LinkExternalIdentityUseCase } from '../../../../domains/identity/use-cases/LinkExternalIdentityUseCase';
import { UnlinkExternalIdentityUseCase } from '../../../../domains/identity/use-cases/UnlinkExternalIdentityUseCase';
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
      const { assertion } = body || {};

      if (!assertion || !assertion.type || !assertion.subjectId) {
        return error(c, 'Dados de afirmação de identidade (assertion) inválidos.', null, 400);
      }

      const result = await this.linkUseCase.execute({
        userId,
        sessionAal,
        assertion,
      });

      if (result.isFailure) {
        return error(c, result.error, null, 400);
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
        const statusCode = result.error.includes('última credencial') ? 409 : 400;
        return error(c, result.error, null, statusCode);
      }

      return success(c, 'Identidade desvinculada com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao desvincular identidade externa', message, 500);
    }
  }
}
