import { Context } from 'hono';
import { CreateDidUseCase } from '../../../../domains/ssi/use-cases/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from '../../../../domains/ssi/use-cases/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from '../../../../domains/ssi/use-cases/RevokeCredentialUseCase';
import { ISsiRepository } from '../../../../application/ports/output/ISsiRepository';

export class SsiController {
  constructor(
    private readonly createDidUseCase: CreateDidUseCase,
    private readonly issueVcUseCase: IssueVerifiableCredentialUseCase,
    private readonly revokeVcUseCase: RevokeCredentialUseCase,
    private readonly ssiRepo: ISsiRepository
  ) {}

  async createDid(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json().catch(() => ({}));
      const result = await this.createDidUseCase.execute({
        userId,
        method: body.method || 'key',
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, message: 'DID gerado com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async issueCredential(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json();
      const result = await this.issueVcUseCase.execute({
        holderUserId: userId,
        credentialType: body.credentialType || 'CivicIdentityCredential',
        claims: body.claims || {},
        expirationDays: body.expirationDays || 365,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, message: 'Credencial Verificável emitida com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async revokeCredential(c: Context): Promise<Response> {
    try {
      const body = await c.req.json();
      const result = await this.revokeVcUseCase.execute({ credentialId: body.credentialId });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, message: 'Credencial Verificável revogada com sucesso' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async listMyCredentials(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const didRes = await this.ssiRepo.findDidByUserId(userId);
      const vcsRes = await this.ssiRepo.listVerifiableCredentialsByUserId(userId);

      return c.json({
        success: true,
        data: {
          did: didRes.isSuccess ? didRes.getValue() : null,
          credentials: vcsRes.isSuccess ? vcsRes.getValue() : [],
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }
}
