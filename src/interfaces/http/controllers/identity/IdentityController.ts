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
    private readonly authenticateUseCase?: AuthenticateAccountUseCase,
    private readonly jwtService?: IJwtService,
    private readonly sessionRepo?: ISessionRepository,
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
      if (!this.authenticateUseCase) {
        return error(c, 'Caso de uso de autenticação não configurado.', null, 500);
      }

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
      const effectiveAal = 1;
      return this.issueSessionResponse(c, user.userId, user.email, user.publicId, user.status, effectiveAal, new Date(), 'password');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno no servidor ao processar autenticação', message, 500);
    }
  }

  async generateWeb3Challenge(c: Context): Promise<Response> {
    try {
      const db = c.get('db');
      const { DrizzleAuthTransactionRepository } = await import('../../../../infrastructure/repositories/DrizzleAuthTransactionRepository');
      const { GenerateWeb3ChallengeUseCase } = await import('../../../../application/use-cases/web3/GenerateWeb3ChallengeUseCase');
      
      const authTxRepo = new DrizzleAuthTransactionRepository(db);
      const generateWeb3ChallengeUseCase = new GenerateWeb3ChallengeUseCase(authTxRepo);

      const body = await c.req.json().catch(() => ({}));
      const query = c.req.query();
      const domain = c.env?.SIWE_ALLOWED_DOMAIN || c.req.header('host') || 'api.asppibra.com';
      const address = body.address || query.address;

      const result = await generateWeb3ChallengeUseCase.execute({
        context: (body.context || query.context || 'login') as any,
        domain,
        address,
        chainId: Number(body.chainId || query.chainId) || 56,
      });

      return success(c, 'Challenge gerado com sucesso', result);
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

      // SIWE Domain: usa configuração de ambiente ou host de origem
      const domain = c.env?.SIWE_ALLOWED_DOMAIN || c.req.header('host') || 'api.asppibra.com';

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

  private async issueSessionResponse(
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

    if (!this.sessionRepo || !this.jwtService) {
      return error(c, 'Dependências de sessão não configuradas.', null, 500);
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
    const expireSeconds = 86400; // 24h fixo por especificação de segurança
    const jwtExpiresAt = new Date(now.getTime() + expireSeconds * 1000);

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
    if (!user) {
      return error(c, 'Usuário não encontrado durante a emissão de sessão.', null, 500);
    }
    const userAuthEpoch = user.authEpoch;

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
      accessToken: token, // Canonical compatibility alias
      refreshToken: rawRefreshToken, // Send back for the client to store securely
      expiresIn: expireSeconds,
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
      if (!this.sessionRepo) {
        return error(c, 'Repositório de sessão não configurado.', null, 500);
      }

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
      if (!this.sessionRepo) {
        return error(c, 'Repositório de sessão não configurado.', null, 500);
      }

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

  async getMe(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return error(c, 'Usuário não autenticado', null, 401);
      }

      const db = c.get('db');
      if (!db) {
        return error(c, 'Conexão com banco de dados indisponível', null, 500);
      }

      const userRepo = new (await import('../../../../infrastructure/repositories/DrizzleUserRepositoryAdapter')).DrizzleUserRepositoryAdapter(db);
      const user = await userRepo.findById(userId);

      if (!user) {
        return error(c, 'Usuário não encontrado', null, 404);
      }

      const sessionId = c.get('sessionId') || c.get('user')?.sessionId;
      const sessionAal = c.get('sessionAal') || c.get('user')?.sessionAal || 1;
      const lastAuthenticatedAt = c.get('lastAuthenticatedAt');

      // Buscar roles ativas via repositório
      const activeRoles = typeof userRepo.findActiveUserRoles === 'function'
        ? await userRepo.findActiveUserRoles(userId)
        : [];

      return success(c, 'Perfil de identidade carregado com sucesso', {
        user: {
          id: user.id,
          publicId: user.publicId,
          email: user.email,
          status: user.status,
          subjectType: user.subjectType,
          roles: activeRoles,
        },
        session: {
          id: sessionId,
          aal: sessionAal,
          lastAuthenticatedAt,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao obter perfil da sessão', message, 500);
    }
  }

  async verifyPasskeyRegistration(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return error(c, 'Usuário não autenticado', null, 401);
      }

      const body = await c.req.json().catch(() => ({}));
      const { challengeId, responseJSON } = body || {};

      if (!challengeId || !responseJSON) {
        return error(c, 'Challenge ID e resposta WebAuthn são obrigatórios para registrar passkey.', null, 400);
      }

      const origin = c.env.WEBAUTHN_ALLOWED_ORIGINS;
      const rpID = c.env.WEBAUTHN_RP_ID;

      if (!origin || !rpID) {
        return error(c, 'Configuração de servidor inválida: WEBAUTHN_ALLOWED_ORIGINS ou WEBAUTHN_RP_ID não definidos.', null, 500);
      }

      const db = c.get('db');
      const { DrizzleUnitOfWork } = await import('../../../../infrastructure/repositories/DrizzleUnitOfWork');
      const { VerifyPasskeyRegistrationUseCase } = await import('../../../../application/use-cases/identity/VerifyPasskeyRegistrationUseCase');

      const uow = new DrizzleUnitOfWork(db);
      const verifyRegistration = new VerifyPasskeyRegistrationUseCase(uow);

      const result = await verifyRegistration.execute({
        challengeId,
        responseJSON,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (result.isFailure) {
        return error(c, result.error || 'Falha ao registrar passkey.', null, 400);
      }

      return success(c, 'Passkey registrada com sucesso', result.getValue());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return error(c, 'Erro interno ao verificar registro de passkey', message, 500);
    }
  }

  async oauthLogin(c: Context): Promise<Response> {
    const provider = c.req.param("provider");
    const frontendUrl = c.env?.FRONTEND_URL || "https://app.asppibra.com";
    const callbackUrl = `https://api.asppibra.com/api/v1/identity/oauth/${provider}/callback`;

    if (provider === "google") {
      const clientId = c.env?.GOOGLE_CLIENT_ID;
      if (!clientId || clientId === "REDACTED") {
        return c.redirect(`${frontendUrl}/login?error=OAUTH_NOT_CONFIGURED&provider=Google`);
      }
      const state = crypto.randomUUID();
      if (c.env?.KV_AUTH) {
        await c.env.KV_AUTH.put(`oauth_state:${state}`, "google", { expirationTtl: 600 });
      }
      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
        clientId
      )}&redirect_uri=${encodeURIComponent(
        callbackUrl
      )}&response_type=code&scope=openid%20email%20profile&access_type=online&state=${state}&prompt=select_account`;

      return c.redirect(googleAuthUrl);
    }

    if (provider === "github") {
      const clientId = c.env?.GITHUB_CLIENT_ID;
      if (!clientId || clientId === "REDACTED") {
        return c.redirect(`${frontendUrl}/login?error=OAUTH_NOT_CONFIGURED&provider=GitHub`);
      }
      const state = crypto.randomUUID();
      if (c.env?.KV_AUTH) {
        await c.env.KV_AUTH.put(`oauth_state:${state}`, "github", { expirationTtl: 600 });
      }
      const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
        clientId
      )}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=read:user%20user:email&state=${state}`;

      return c.redirect(githubAuthUrl);
    }

    return c.redirect(`${frontendUrl}/login?error=UNSUPPORTED_PROVIDER`);
  }

  async oauthCallback(c: Context): Promise<Response> {
    const provider = c.req.param("provider");
    const frontendUrl = c.env?.FRONTEND_URL || "https://app.asppibra.com";
    const callbackUrl = `https://api.asppibra.com/api/v1/identity/oauth/${provider}/callback`;
    const providerName = provider === "google" ? "Google" : provider === "github" ? "GitHub" : provider;

    const code = c.req.query("code");
    const state = c.req.query("state");
    const errorParam = c.req.query("error");

    if (errorParam || !code) {
      return c.redirect(
        `${frontendUrl}/login?error=${encodeURIComponent(errorParam || "OAUTH_CANCELLED")}&provider=${providerName}`
      );
    }

    try {
      let providerUserId = "";
      let email = "";
      let displayName = "";

      if (provider === "google") {
        const clientId = c.env?.GOOGLE_CLIENT_ID;
        const clientSecret = c.env?.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret || clientId === "REDACTED") {
          return c.redirect(`${frontendUrl}/login?error=OAUTH_NOT_CONFIGURED&provider=Google`);
        }

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: callbackUrl,
            grant_type: "authorization_code",
          }),
        });

        if (!tokenRes.ok) {
          const errBody = await tokenRes.text();
          console.error("Google token exchange error:", errBody);
          return c.redirect(`${frontendUrl}/login?error=TOKEN_EXCHANGE_FAILED&provider=Google`);
        }

        const tokenData: any = await tokenRes.json();
        const accessToken = tokenData.access_token;

        const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!userRes.ok) {
          return c.redirect(`${frontendUrl}/login?error=PROFILE_FETCH_FAILED&provider=Google`);
        }

        const profile: any = await userRes.json();
        providerUserId = profile.id;
        email = profile.email ? profile.email.toLowerCase() : "";
        displayName = profile.name || "";
      } else if (provider === "github") {
        const clientId = c.env?.GITHUB_CLIENT_ID;
        const clientSecret = c.env?.GITHUB_CLIENT_SECRET;
        if (!clientId || !clientSecret || clientId === "REDACTED") {
          return c.redirect(`${frontendUrl}/login?error=OAUTH_NOT_CONFIGURED&provider=GitHub`);
        }

        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "ASPPIBRA-DAO",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: callbackUrl,
          }),
        });

        if (!tokenRes.ok) {
          return c.redirect(`${frontendUrl}/login?error=TOKEN_EXCHANGE_FAILED&provider=GitHub`);
        }

        const tokenData: any = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) {
          return c.redirect(`${frontendUrl}/login?error=TOKEN_EXCHANGE_FAILED&provider=GitHub`);
        }

        const userRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "ASPPIBRA-DAO" },
        });

        if (!userRes.ok) {
          return c.redirect(`${frontendUrl}/login?error=PROFILE_FETCH_FAILED&provider=GitHub`);
        }

        const profile: any = await userRes.json();
        providerUserId = String(profile.id);
        displayName = profile.name || profile.login;
        email = profile.email ? profile.email.toLowerCase() : "";

        if (!email) {
          const emailsRes = await fetch("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "ASPPIBRA-DAO" },
          });
          if (emailsRes.ok) {
            const emails: any = await emailsRes.json();
            const primary = emails.find((e: any) => e.primary && e.verified);
            if (primary) email = primary.email.toLowerCase();
          }
        }
      } else {
        return c.redirect(`${frontendUrl}/login?error=UNSUPPORTED_PROVIDER`);
      }

      // ----------------------------------------------------------------------
      // ANTI-SHADOW ACCOUNT VERIFICATION
      // ----------------------------------------------------------------------
      const db = c.get("db");
      const { oauthIdentities } = await import("../../../../db/authentication/tables");
      const { users } = await import("../../../../db/user/tables");
      const { eq, and } = await import("drizzle-orm");

      const existingLink = await db
        .select()
        .from(oauthIdentities)
        .where(
          and(
            eq(oauthIdentities.provider, provider),
            eq(oauthIdentities.subjectId, providerUserId),
            eq(oauthIdentities.status, "active")
          )
        )
        .limit(1);

      let targetUserId: number | null = null;
      let targetUserEmail = email;

      if (existingLink.length > 0) {
        targetUserId = existingLink[0].userId;
        const u = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
        if (u.length > 0 && u[0].status === "active") {
          targetUserEmail = u[0].email;
        } else {
          targetUserId = null;
        }
      } else if (email) {
        const existingUser = await db
          .select()
          .from(users)
          .where(and(eq(users.email, email), eq(users.status, "active")))
          .limit(1);

        if (existingUser.length > 0) {
          targetUserId = existingUser[0].id;
          targetUserEmail = existingUser[0].email;

          await db.insert(oauthIdentities).values({
            id: crypto.randomUUID(),
            userId: targetUserId,
            provider,
            subjectId: providerUserId,
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      // Anti-Shadow Account: If user does not exist in platform, reject cleanly!
      if (!targetUserId) {
        return c.redirect(
          `${frontendUrl}/login?error=IDENTITY_NOT_LINKED&provider=${providerName}&email=${encodeURIComponent(
            email
          )}`
        );
      }

      // ----------------------------------------------------------------------
      // ISSUE SESSION & TOKEN
      // ----------------------------------------------------------------------
      const familyId = crypto.randomUUID();
      const jti = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const sessionExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      const jwtExpiresAt = new Date(now.getTime() + 24 * 3600 * 1000);

      const rawRefreshToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const refreshTokenHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawRefreshToken));
      const refreshTokenHash = Array.from(new Uint8Array(refreshTokenHashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
      const userAgent = c.req.header("user-agent") || "unknown";

      if (this.sessionRepo?.createRefreshTokenFamily) {
        await this.sessionRepo.createRefreshTokenFamily({
          id: familyId,
          userId: targetUserId,
          createdAt: now,
        });
      }

      await this.sessionRepo.createSession({
        id: sessionId,
        userId: targetUserId,
        jti,
        ip,
        userAgent,
        familyId,
        refreshTokenHash,
        aal: 1,
        authEpoch: 1,
        createdAt: now,
        expiresAt: sessionExpiresAt,
        lastAuthenticatedAt: now,
      } as any);

      const token = await this.jwtService.sign(
        {
          sub: String(targetUserId),
          userId: targetUserId,
          email: targetUserEmail,
          sid: sessionId,
          jti,
          aal: 1,
          auth_time: Math.floor(now.getTime() / 1000),
          exp: Math.floor(jwtExpiresAt.getTime() / 1000),
        },
        c.env.JWT_SECRET
      );

      return c.redirect(`${frontendUrl}/auth/oauth/callback?token=${token}`);
    } catch (err: unknown) {
      console.error("OAuth Callback Error:", err);
      return c.redirect(`${frontendUrl}/login?error=OAUTH_INTERNAL_ERROR&provider=${providerName}`);
    }
  }
}
