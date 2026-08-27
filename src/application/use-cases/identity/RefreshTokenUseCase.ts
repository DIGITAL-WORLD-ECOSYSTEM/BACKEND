import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { RefreshTokenDTO, RefreshTokenResult } from '../../../application/dto/identity/RefreshTokenDTO';

export interface ITokenService {
  generateAccessToken(payload: { userId: number; email: string; authEpoch: number }): Promise<string>;
  generateRefreshToken(): Promise<string>;
}

export class RefreshTokenUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly tokenService: ITokenService,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: RefreshTokenDTO): Promise<Result<RefreshTokenResult>> {
    if (!dto.refreshToken) {
      return Result.fail<RefreshTokenResult>('Refresh token é obrigatório.');
    }

    const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dto.refreshToken.trim()));
    const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    return await this.uow.execute(async (factory) => {
      const sessionRepo = factory.getSessionRepository();
      const userRepo = factory.getUserRepository();

      const session = await sessionRepo.getSessionByRefreshTokenHash(tokenHash);
      if (!session) {
        return Result.fail<RefreshTokenResult>('Sessão ou refresh token inválido.');
      }

      if (session.revokedAt) {
        // MALICIOUS REUSE DETECTED: Revoke the entire family!
        if (session.familyId) {
          await sessionRepo.revokeFamily(session.familyId, 'Malicious refresh token reuse detected');
        } else {
          await sessionRepo.revokeAllUserSessions(session.userId);
        }

        if (typeof userRepo.incrementAuthEpoch === 'function') {
          await userRepo.incrementAuthEpoch(session.userId);
        }

        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'refresh_token_reuse_detected',
            userId: session.userId,
            metadata: { sessionId: session.id, familyId: session.familyId },
          });
        }

        return Result.fail<RefreshTokenResult>('Refresh token reutilizado. Por razões de segurança, todas as sessões relacionadas foram encerradas.');
      }

      if (new Date(session.expiresAt) < new Date()) {
        return Result.fail<RefreshTokenResult>('Refresh token expirado. Faça login novamente.');
      }

      const user = await userRepo.findById(session.userId);
      if (!user || user.status !== 'active') {
        return Result.fail<RefreshTokenResult>('Usuário inativo ou não encontrado.');
      }

      // 1. Revoke the current session as it's been consumed (Single-use)
      await sessionRepo.revokeSession(session.id);

      const newAccessToken = await this.tokenService.generateAccessToken({
        userId: user.id,
        email: user.email || '',
        authEpoch: user.authEpoch || 1,
      });

      const newRefreshToken = await this.tokenService.generateRefreshToken();

      // Create new session in the same family
      const newSessionId = crypto.randomUUID();
      const newJti = crypto.randomUUID();
      const newRefreshTokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(newRefreshToken));
      const newRefreshTokenHash = Array.from(new Uint8Array(newRefreshTokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 86400 * 1000 * 30); // 30 days for refresh session TTL

      await sessionRepo.createSession({
        id: newSessionId,
        userId: user.id,
        jti: newJti,
        ip: session.ip, // Inherit IP from previous session or update from request if possible
        userAgent: session.userAgent,
        familyId: session.familyId, // Inherit the family
        refreshTokenHash: newRefreshTokenHash,
        aal: session.aal,
        authEpoch: user.authEpoch || 1,
        createdAt: now,
        expiresAt,
      });

      return Result.ok<RefreshTokenResult>({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600, // 1 hour access token
      });
    });
  }
}
