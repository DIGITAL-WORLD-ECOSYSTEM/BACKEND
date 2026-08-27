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
