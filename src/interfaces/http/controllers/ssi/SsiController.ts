import { Context } from 'hono';
import { CreateDidUseCase } from '../../../../application/use-cases/ssi/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from '../../../../application/use-cases/ssi/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from '../../../../application/use-cases/ssi/RevokeCredentialUseCase';
import { VerifyVerifiableCredentialUseCase } from '../../../../application/use-cases/ssi/VerifyVerifiableCredentialUseCase';
import { ISsiRepository } from '../../../../application/ports/output/ISsiRepository';
import { ICryptoVaultPort } from '../../../../application/ports/security/ICryptoVaultPort';

export class SsiController {
  constructor(
    private readonly createDidUseCase: CreateDidUseCase,
    private readonly issueVcUseCase: IssueVerifiableCredentialUseCase,
    private readonly revokeVcUseCase: RevokeCredentialUseCase,
    private readonly ssiRepo: ISsiRepository,
    private readonly verifyVcUseCase?: VerifyVerifiableCredentialUseCase,
    private readonly cryptoVault?: ICryptoVaultPort,
    private readonly encryptionKey?: string
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
        isPrimary: body.isPrimary,
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

      // Sanitize claims against prototype pollution
      const rawClaims = body.claims && typeof body.claims === 'object' && !Array.isArray(body.claims) ? body.claims : {};
      const claims: Record<string, any> = {};
      for (const [key, value] of Object.entries(rawClaims)) {
        if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
          claims[key] = value;
        }
      }

      const result = await this.issueVcUseCase.execute({
        holderUserId: userId,
        credentialType: body.credentialType || 'CivicIdentityCredential',
        claims,
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
      const actorUserId = c.get('userId') || c.get('user')?.userId;
      if (!actorUserId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json();
      const permissions: string[] = c.get('permissions') || [];
      const isIssuerOrAdmin =
        Array.isArray(permissions) &&
        (permissions.includes('ssi.credential.revoke') || permissions.includes('*') || permissions.includes('admin'));

      const result = await this.revokeVcUseCase.execute({
        credentialId: body.credentialId,
        actorUserId,
        isIssuerOrAdmin,
      });

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

      let credentials = vcsRes.isSuccess ? vcsRes.getValue() : [];

      // Decrypt claims for the authenticated holder so they have possession of their data
      if (this.cryptoVault && this.encryptionKey && credentials.length > 0) {
        credentials = await Promise.all(
          credentials.map(async (vc) => {
            try {
              if (vc.encryptedClaims) {
                const decryptedStr = await this.cryptoVault!.decrypt(vc.encryptedClaims, this.encryptionKey!);
                const claims = JSON.parse(decryptedStr);
                return {
                  ...vc,
                  claims,
                };
              }
            } catch {
              // Return original record if decryption fails
            }
            return vc;
          })
        );
      }

      return c.json({
        success: true,
        data: {
          did: didRes.isSuccess ? didRes.getValue() : null,
          credentials,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async verifyCredential(c: Context): Promise<Response> {
    try {
      const body = await c.req.json();

      if (!this.verifyVcUseCase) {
        return c.json({ success: false, message: 'Serviço de verificação não configurado no controlador' }, 500);
      }

      // Support both raw Verifiable Credential and Verifiable Presentation (VP)
      const isPresentation =
        (body.type && (body.type.includes('VerifiablePresentation') || body.type === 'VerifiablePresentation')) ||
        Boolean(body.verifiablePresentation);

      let credentialDocument: any;
      let presentationChallenge: string | undefined;
      let vpDocument: any;

      if (isPresentation) {
        vpDocument = body.verifiablePresentation || body;
        presentationChallenge = vpDocument.proof?.challenge;
        if (Array.isArray(vpDocument.verifiableCredential)) {
          credentialDocument = vpDocument.verifiableCredential[0];
        } else {
          credentialDocument = vpDocument.verifiableCredential;
        }
      } else {
        credentialDocument = body.credentialDocument || body;
      }

      const expectedChallenge =
        (typeof c.req?.query === 'function' ? c.req.query('challenge') : undefined) || body.expectedChallenge;
      const hasSignedPresentation = Boolean(vpDocument?.proof?.proofValue);

      const result = await this.verifyVcUseCase.execute({
        credentialDocument,
        ...(hasSignedPresentation ? { verifiablePresentation: vpDocument } : {}),
        ...(expectedChallenge ? { expectedChallenge } : {}),
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error, isValid: false }, 400);
      }

      return c.json(
        {
          success: true,
          message: 'Credencial Verificável autêntica e válida',
          data: {
            ...result.getValue(),
            ...(presentationChallenge ? { presentationChallenge } : {}),
          },
        },
        200
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }
}
