import { IAuthTransactionRepository } from '../../../application/ports/output/IAuthTransactionRepository';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { SiweMessage } from '../../../domains/web3/value-objects/SiweMessage';

export interface GenerateWeb3ChallengeInputDTO {
  domain: string;
  address?: string;
  uri?: string;
  statement?: string;
  chainId?: number;
  context?: 'login' | 'credential_link';
}

export interface GenerateWeb3ChallengeOutputDTO {
  challengeId: string;
  nonce: string;
  domain: string;
  statement: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expiresAt: string;
  message?: string;
}

/**
 * Caso de Uso: GenerateWeb3ChallengeUseCase
 * Gera desafios criptográficos no padrão EIP-4361 (SIWE) com nonces imprevisíveis CSPRNG,
 * expiração estrita de 5 minutos e persistência para mitigação de Replay Attacks.
 */
export class GenerateWeb3ChallengeUseCase {
  constructor(private readonly authTxRepo: IAuthTransactionRepository) {}

  async execute(input: GenerateWeb3ChallengeInputDTO): Promise<GenerateWeb3ChallengeOutputDTO> {
    const domain = input.domain.trim().toLowerCase();
    const chainId = input.chainId ?? 56; // Padrão BSC Mainnet
    const statement = input.statement || 'Assine esta mensagem para autenticar ou vincular sua carteira ao ecossistema.';
    const uri = input.uri || `https://${domain}`;

    // 1. Gera nonce alfanumérico seguro de 32 hexadecimais via CSPRNG
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const nonce = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const challengeId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutos de tolerância

    // 2. Persiste o desafio no repositório de autenticação
    const challenge = new AuthenticationChallenge({
      id: challengeId,
      challengeHash: nonce,
      challengeType: 'siwe',
      context: input.context || 'credential_link',
      createdAt: now,
      expiresAt,
    });

    await this.authTxRepo.createChallenge(challenge);

    // 3. Se o endereço foi informado, monta a mensagem EIP-4361 formatada
    let formattedMessage: string | undefined;
    if (input.address) {
      const siweMsg = new SiweMessage({
        domain,
        address: input.address,
        statement,
        uri,
        chainId,
        nonce,
        issuedAt: now,
        expirationTime: expiresAt,
      });
      formattedMessage = siweMsg.toMessage();
    }

    return {
      challengeId,
      nonce,
      domain,
      statement,
      uri,
      chainId,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      message: formattedMessage,
    };
  }
}
