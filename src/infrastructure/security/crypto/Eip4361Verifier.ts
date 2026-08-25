import { SiweMessage } from 'siwe';
import { ISiweVerifierPort, SiweVerificationInput, SiweVerificationOutput } from '../../../application/ports/security/ISiweVerifierPort';

export class Eip4361Verifier implements ISiweVerifierPort {
  async verify(input: SiweVerificationInput): Promise<SiweVerificationOutput> {
    try {
      const siweMessage = new SiweMessage(input.message);
      const result = await siweMessage.verify({
        signature: input.signature,
        nonce: input.expectedNonce,
        domain: input.expectedDomain,
      });

      if (!result.success) {
        throw new Error(result.error?.type || 'Assinatura SIWE EIP-4361 inválida.');
      }

      return {
        address: result.data.address.toLowerCase(),
        chainId: result.data.chainId,
        nonce: result.data.nonce,
        domain: result.data.domain,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha na verificação da assinatura SIWE.';
      throw new Error(message);
    }
  }
}
