import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { IWalletGeneratorPort, GeneratedWalletData } from '../../../application/ports/security/IWalletGeneratorPort';

/**
 * Adaptador de Infraestrutura: Gerador de Carteira usando Viem.
 * Esta classe isola a dependência da biblioteca 'viem' do resto do sistema.
 */
export class ViemWalletGenerator implements IWalletGeneratorPort {
  async generateWallet(): Promise<GeneratedWalletData> {
    // 1. Gera uma chave privada segura de 256 bits (32 bytes) via CSPRNG nativo.
    const privateKey = generatePrivateKey();
    
    // 2. Deriva matematicamente a conta completa (incluindo o Public Address).
    const account = privateKeyToAccount(privateKey);

    return {
      address: account.address,
      privateKey: privateKey,
    };
  }
}
