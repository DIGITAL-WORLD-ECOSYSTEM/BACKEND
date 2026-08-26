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

      const session = await sessionRepo.getSessionById(tokenHash);
      if (!session) {
        return Result.fail<RefreshTokenResult>('Sessão ou refresh token inválido.');
      }

      if (session.revokedAt) {
        // MALICIOUS REUSE DETECTED: Revoke all sessions for this user!
        if (typeof userRepo.incrementAuthEpoch === 'function') {
          await userRepo.incrementAuthEpoch(session.userId);
        }
        await sessionRepo.revokeAllUserSessions(session.userId);

        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'refresh_token_reuse_detected',
            userId: session.userId,
            metadata: { sessionId: session.id, action: 'revoked_all_user_sessions' },
          });
        }

        return Result.fail<RefreshTokenResult>('Refresh token reutilizado. Por razões de segurança, todas as sessões foram encerradas.');
      }

      if (new Date(session.expiresAt) < new Date()) {
        return Result.fail<RefreshTokenResult>('Sessão expirada. Faça login novamente.');
      }

      const user = await userRepo.findById(session.userId);
      if (!user || user.status !== 'active') {
        return Result.fail<RefreshTokenResult>('Usuário inativo ou não encontrado.');
      }

      const newAccessToken = await this.tokenService.generateAccessToken({
        userId: user.id,
        email: user.email || '',
        authEpoch: user.authEpoch || 1,
      });

      const newRefreshToken = await this.tokenService.generateRefreshToken();

      return Result.ok<RefreshTokenResult>({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600,
      });
    });
  }
}
