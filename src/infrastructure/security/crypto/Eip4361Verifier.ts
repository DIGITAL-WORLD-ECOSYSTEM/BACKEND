import { SiweMessage } from 'siwe';
import { getAddress } from 'viem';
import { ISiweVerifierPort, SiweVerificationInput, SiweVerificationOutput } from '../../../application/ports/security/ISiweVerifierPort';

export class Eip4361Verifier implements ISiweVerifierPort {
  async verify(input: SiweVerificationInput): Promise<SiweVerificationOutput> {
    try {
      let canonicalMessage = input.message;
      const lines = input.message.split('\n');
      if (lines.length >= 2 && lines[1].trim().startsWith('0x') && lines[1].trim().length === 42) {
        try {
          lines[1] = getAddress(lines[1].trim());
          canonicalMessage = lines.join('\n');
        } catch {}
      }

      const siweMessage = new SiweMessage(canonicalMessage);
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
