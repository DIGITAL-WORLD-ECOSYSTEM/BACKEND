import { SiweMessage as SiweParser } from 'siwe';
import { verifyMessage } from 'viem';
import {
  ISiweVerifierPort,
  SiweVerificationInput,
  SiweVerificationOutput,
} from '../../../application/ports/security/ISiweVerifierPort';
import {
  InvalidSiweSignatureError,
  ExpiredChallengeError,
} from '../../../domains/web3/errors/Web3Errors';

/**
 * Adaptador Criptográfico de Verificação SIWE EIP-4361 com Viem
 * Realiza a análise semântica da mensagem EIP-4361 e a validação criptográfica
 * da assinatura digital na curva secp256k1 de maneira performática e segura.
 */
export class ViemSiweVerifierAdapter implements ISiweVerifierPort {
  async verify(input: SiweVerificationInput): Promise<SiweVerificationOutput> {
    if (!input.message || !input.signature) {
      throw new InvalidSiweSignatureError('Mensagem e assinatura são obrigatórias.');
    }

    let parsed: any;
    try {
      parsed = new SiweParser(input.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Formato inválido';
      throw new InvalidSiweSignatureError(`Mensagem EIP-4361 malformada: ${msg}`);
    }

    // 1. Validação de Domínio Autorizado (Anti-Phishing)
    if (input.expectedDomain) {
      const normalizedExpected = input.expectedDomain.toLowerCase().trim();
      const normalizedParsed = parsed.domain.toLowerCase().trim();
      if (normalizedParsed !== normalizedExpected) {
        throw new InvalidSiweSignatureError(
          `Domínio não autorizado. Esperado '${normalizedExpected}', recebido '${normalizedParsed}'.`
        );
      }
    }

    // 2. Validação de Nonce Anti-Replay
    if (input.expectedNonce) {
      if (parsed.nonce !== input.expectedNonce) {
        throw new InvalidSiweSignatureError('Nonce EIP-4361 não confere com o desafio emitido.');
      }
    }

    // 3. Validação de Expiração Temporal
    if (parsed.expirationTime) {
      const expDate = new Date(parsed.expirationTime);
      if (Date.now() > expDate.getTime()) {
        throw new ExpiredChallengeError();
      }
    }

    // 4. Validação Not-Before (se presente)
    if (parsed.notBefore) {
      const nbfDate = new Date(parsed.notBefore);
      if (Date.now() < nbfDate.getTime()) {
        throw new InvalidSiweSignatureError('Mensagem ainda não válida (notBefore no futuro).');
      }
    }

    // 5. Verificação Criptográfica da Assinatura via Viem (EIP-191 personal_sign)
    try {
      const isValid = await verifyMessage({
        address: parsed.address as `0x${string}`,
        message: input.message,
        signature: input.signature as `0x${string}`,
      });

      if (!isValid) {
        throw new InvalidSiweSignatureError('Assinatura inválida para o endereço fornecido.');
      }
    } catch (err: unknown) {
      if (err instanceof InvalidSiweSignatureError) throw err;
      const msg = err instanceof Error ? err.message : 'Falha na verificação de assinatura';
      throw new InvalidSiweSignatureError(msg);
    }

    return {
      address: parsed.address.toLowerCase(),
      chainId: parsed.chainId,
      nonce: parsed.nonce,
      domain: parsed.domain,
    };
  }
}
