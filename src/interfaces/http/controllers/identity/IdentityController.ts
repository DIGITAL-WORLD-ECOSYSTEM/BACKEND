import { Context } from 'hono';
import { AuthenticateAccountUseCase } from '../../../../application/use-cases/identity/AuthenticateAccountUseCase';
import { RegisterAccountUseCase } from '../../../../application/use-cases/identity/RegisterAccountUseCase';
import { VerifyWalletIdentityUseCase } from '../../../../application/use-cases/identity/VerifyWalletIdentityUseCase';
import { VerifyPasskeyIdentityUseCase } from '../../../../application/use-cases/identity/VerifyPasskeyIdentityUseCase';
import { IJwtService } from '../../../../application/ports/security/IJwtService';
import { ISessionRepository } from '../../../../application/ports/output/ISessionRepository';
import { error, success } from '../../helpers/response';

export class IdentityController {
  constructor(
    private readonly authenticateUseCase: AuthenticateAccountUseCase,
    private readonly jwtService: IJwtService,
    private readonly sessionRepo: ISessionRepository,
    private readonly registerUseCase?: RegisterAccountUseCase,
    private readonly verifyWalletUseCase?: VerifyWalletIdentityUseCase,
    private readonly verifyPasskeyUseCase?: VerifyPasskeyIdentityUseCase
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
      return this.issueSessionResponse(c, user.userId, user.email, user.publicId, user.status, 1, new Date(), 'password');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno no servidor ao processar autenticação', message, 500);
    }
  }

  async generateWeb3Challenge(c: Context): Promise<Response> {
    try {
      const db = c.get('db');
      const { DrizzleUnitOfWork } = await import('../../../../infrastructure/repositories/DrizzleUnitOfWork');
      const { GenerateWeb3ChallengeUseCase } = await import('../../../../application/use-cases/identity/GenerateWeb3ChallengeUseCase');
      
      const uow = new DrizzleUnitOfWork(db);
      const generateWeb3ChallengeUseCase = new GenerateWeb3ChallengeUseCase(uow);

      const body = await c.req.json().catch(() => ({}));
      const { transactionId, context } = body || {};

      const domain = c.req.header('host') || 'w3.app'; // Em prod, pegar env.EXPECTED_DOMAIN

      const result = await generateWeb3ChallengeUseCase.execute({
        context: context || 'login',
        transactionId,
        domain,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha ao gerar challenge Web3', null, 400);
      }

      return success(c, 'Challenge gerado com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao gerar challenge Web3', message, 500);
    }
  }

  async loginWeb3(c: Context): Promise<Response> {
    try {
      if (!this.verifyWalletUseCase) {
        return error(c, 'Autenticação Web3 não configurada.', null, 500);
      }

      const body = await c.req.json().catch(() => ({}));
      const { challengeId, message, signature } = body || {};

      if (!challengeId || !message || !signature) {
        return error(c, 'Challenge ID, Mensagem SIWE e assinatura são obrigatórios.', null, 400);
      }

      // SECURITY ENFORCEMENT: Fail-Closed. Env vars MUST be configured. No silent fallback.
      const domain = c.env.SIWE_ALLOWED_DOMAIN;
      if (!domain) {
        return error(c, 'Configuração de servidor inválida: SIWE_ALLOWED_DOMAIN não definido.', null, 500);
      }

      const result = await this.verifyWalletUseCase.execute({
        challengeId,
        message,
        signature,
        expectedDomain: domain,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha na autenticação Web3', null, 401);
      }

      const walletAuth = result.getValue();
      return this.issueSessionResponse(c, walletAuth.userId, `wallet_${walletAuth.address}@w3.app`, null, 'active', 2, new Date(), 'web3_wallet');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao processar autenticação Web3 SIWE', message, 500);
    }
  }

  async generatePasskeyChallenge(c: Context): Promise<Response> {
    try {
      const db = c.get('db');
      const { DrizzleUnitOfWork } = await import('../../../../infrastructure/repositories/DrizzleUnitOfWork');
      const { GeneratePasskeyChallengeUseCase } = await import('../../../../application/use-cases/identity/GeneratePasskeyChallengeUseCase');
      
      const uow = new DrizzleUnitOfWork(db);
      const generatePasskeyChallengeUseCase = new GeneratePasskeyChallengeUseCase(uow);

      const body = await c.req.json().catch(() => ({}));
      let { transactionId, context, userId, userName } = body || {};

      if (context === 'credential_link') {
        const sessionUser = c.get('user');
        if (!sessionUser || !sessionUser.userId) {
          return error(c, 'Sessão ativa necessária para registrar Passkey', null, 401);
        }
        userId = sessionUser.userId;
      }

      const rpID = c.env.WEBAUTHN_RP_ID || 'w3.app';
      const rpName = 'ASPPIBRA W3';

      const result = await generatePasskeyChallengeUseCase.execute({
        context: context || 'login',
        transactionId,
        userId,
        userName,
        rpID,
        rpName,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha ao gerar challenge Passkey', null, 400);
      }

      return success(c, 'Challenge gerado com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao gerar challenge Passkey', message, 500);
    }
  }

  async loginPasskey(c: Context): Promise<Response> {
    try {
      if (!this.verifyPasskeyUseCase) {
        return error(c, 'Autenticação Passkey não configurada.', null, 500);
      }

      const body = await c.req.json().catch(() => ({}));
      const { challengeId, responseJSON } = body || {};

      if (!challengeId || !responseJSON) {
        return error(c, 'Challenge ID e resposta WebAuthn são obrigatórios.', null, 400);
      }

      // SECURITY ENFORCEMENT: Fail-Closed. Env vars MUST be configured. No silent fallback.
      const origin = c.env.WEBAUTHN_ALLOWED_ORIGINS;
      const rpID = c.env.WEBAUTHN_RP_ID;
      if (!origin || !rpID) {
        return error(c, 'Configuração de servidor inválida: WEBAUTHN_ALLOWED_ORIGINS ou WEBAUTHN_RP_ID não definidos.', null, 500);
      }

      const result = await this.verifyPasskeyUseCase.execute({
        challengeId,
        responseJSON,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha na autenticação Passkey', null, 401);
      }

      const passkeyAuth = result.getValue();
      return this.issueSessionResponse(c, passkeyAuth.userId, `passkey_${passkeyAuth.credentialId}@w3.app`, null, 'active', 2, new Date(), 'passkey');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao processar autenticação Passkey', message, 500);
    }
  }

  public async issueSessionResponse(
    c: Context,
    userId: number,
    email: string,
    publicId: string | null,
    status: string,
    effectiveAal: number,
    authTime: Date,
    authMethod: string
  ): Promise<Response> {
    const jwtSecret = c.env?.JWT_SECRET;
    if (!jwtSecret) {
      return error(c, 'Erro de configuração do servidor (JWT_SECRET ausente).', null, 500);
    }

    const sessionId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const jti = crypto.randomUUID();
    
    // Generate secure refresh token
    const rawRefreshToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const refreshTokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawRefreshToken));
    const refreshTokenHash = Array.from(new Uint8Array(refreshTokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const userAgent = c.req.header('user-agent') || 'unknown';
    
    const now = new Date();
    const sessionExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000); // 30 days for refresh session
    const jwtExpiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins for access token

    // Create the token family first
    if (this.sessionRepo.createRefreshTokenFamily) {
      await this.sessionRepo.createRefreshTokenFamily({
        id: familyId,
        userId,
        createdAt: now,
      });
    }

    // Get actual user authEpoch instead of hardcoding 1
    const db = c.get('db');
    const userRepo = new (await import('../../../../infrastructure/repositories/DrizzleUserRepositoryAdapter')).DrizzleUserRepositoryAdapter(db);
    const user = await userRepo.findById(userId);
    const userAuthEpoch = user?.authEpoch || 1;

    await this.sessionRepo.createSession({
      id: sessionId,
      userId,
      jti,
      ip,
      userAgent,
      familyId,
      refreshTokenHash,
      aal: effectiveAal,
      authEpoch: userAuthEpoch,
      createdAt: now,
      expiresAt: sessionExpiresAt,
      lastAuthenticatedAt: authTime,
    } as any); // Type cast due to possible interface mismatches, since we added lastAuthenticatedAt

    const token = await this.jwtService.sign(
      {
        sub: publicId || String(userId),
        userId,
        email,
        publicId,
        sid: sessionId,
        jti,
        aal: effectiveAal,
        auth_time: Math.floor(authTime.getTime() / 1000),
        exp: Math.floor(jwtExpiresAt.getTime() / 1000), 
      },
      jwtSecret
    );

    return success(c, 'Autenticação realizada com sucesso', {
      token, // Access Token
      refreshToken: rawRefreshToken, // Send back for the client to store securely
      expiresIn: 15 * 60, // 15 minutes
      user: {
        id: userId,
        email,
        publicId,
        status,
      },
      session: {
        id: sessionId,
        aal: effectiveAal,
        auth_time: authTime.toISOString(),
        expiresAt: sessionExpiresAt,
      },
    });
  }

  async logout(c: Context): Promise<Response> {
    try {
      const sessionId = c.get('sessionId') || c.get('user')?.sessionId;
      if (!sessionId) {
        return error(c, 'Sessão ativa não encontrada', null, 400);
      }

      await this.sessionRepo.revokeSession(sessionId);
      return success(c, 'Sessão encerrada com sucesso');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao realizar logout', message, 500);
    }
  }

  async logoutAll(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return error(c, 'Usuário não autenticado', null, 401);
      }

      await this.sessionRepo.revokeAllUserSessions(userId);
      return success(c, 'Todas as sessões ativas foram encerradas com sucesso.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao realizar logout global', message, 500);
    }
  }
}

