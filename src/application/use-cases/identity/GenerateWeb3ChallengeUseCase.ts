import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { CryptoVault } from '../../../infrastructure/security/crypto/crypto';

export interface GenerateWeb3ChallengeDTO {
  context: 'login' | 'credential_link';
  transactionId?: string;
  domain: string;
}

export class GenerateWeb3ChallengeUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: GenerateWeb3ChallengeDTO): Promise<Result<{ challengeId: string; nonce: string; domain: string }>> {
    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();

      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const challengeId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

      const challenge = new AuthenticationChallenge({
        id: challengeId,
        transactionId: dto.transactionId || null,
        challengeHash: nonce, // Para SIWE, o hash é o nonce
        challengeType: 'siwe',
        context: dto.context,
        createdAt: now,
        expiresAt,
      });

      await authTxRepo.createChallenge(challenge);

      return Result.ok({
        challengeId,
        nonce,
        domain: dto.domain,
      });
    });
  }
}
