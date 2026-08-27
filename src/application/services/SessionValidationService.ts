import { DrizzleSessionRepository } from '../../infrastructure/repositories/DrizzleSessionRepository';
import { DrizzleUserRepositoryAdapter } from '../../infrastructure/repositories/DrizzleUserRepositoryAdapter';
import { IJwtService } from '../ports/security/IJwtService';

export interface ValidationContext {
  token: string;
  secret: string;
  db: any; // Ideally typed, but using any here to match existing context extraction
}

export interface ValidationResult {
  userId: number;
  sessionId: string;
  sessionAal: number;
  lastAuthenticatedAt?: Date;
  publicId?: string;
}

/**
 * SessionValidationService
 *
 * Centralizes the JWT and Session validation policy for the entire system.
 * Ensures that both stateful session checks (authEpoch, canAuthenticate) and
 * stateless JWT claims (exp, iss, aud, nbf) are enforced universally.
 */
export class SessionValidationService {
  constructor(private readonly jwtService: IJwtService) {}

  async validate(context: ValidationContext): Promise<ValidationResult> {
    const { token, secret, db } = context;

    // 1. Validate JWT cryptographic signature and standard claims
    const payload = await this.jwtService.verify(token, secret);

    if (!payload.sid) {
      throw new Error('Invalid session payload (sid missing).');
    }

    // 2. Fetch session and validate state
    const sessionRepo = new DrizzleSessionRepository(db);
    const sessionRecord = await sessionRepo.getSessionById(payload.sid);

    if (!sessionRecord) {
      throw new Error('Session not found.');
    }

    const { Session } = await import('../../domains/identity/entities/Session');
    const session = Session.fromPersistence(sessionRecord as any);

    if (!session.isValid()) {
      throw new Error(session.isRevoked ? 'Session has been revoked.' : 'Session has expired.');
    }

    // 3. Fetch user and validate eligibility
    const userRepo = new DrizzleUserRepositoryAdapter(db);
    const userRecord = await userRepo.findById(session.userId);

    if (!userRecord) {
      throw new Error('User account not found.');
    }

    const { User } = await import('../../domains/identity/entities/User');
    const user = new User(userRecord as any);

    if (!user.canAuthenticate()) {
      throw new Error(`User account is not eligible for authentication.`);
    }

    // 4. Validate authEpoch to ensure no regressions or bypasses
    if (!session.matchesUserEpoch(user.authEpoch)) {
      throw new Error('Session invalidated due to password reset or security revocation (authEpoch mismatch).');
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      sessionAal: session.aal,
      lastAuthenticatedAt: session.lastAuthenticatedAt,
      publicId: user.publicId,
    };
  }
}
