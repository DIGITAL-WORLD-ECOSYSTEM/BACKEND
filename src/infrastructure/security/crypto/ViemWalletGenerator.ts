import { generateMnemonic, mnemonicToAccount, english } from 'viem/accounts';
import { toHex } from 'viem';
import { IWalletGeneratorPort, GeneratedWalletData } from '../../../application/ports/security/IWalletGeneratorPort';

/**
 * Adaptador de Infraestrutura: Gerador de Carteira usando Viem.
 * Implementa o padrão BIP-39 (24 palavras por padrão / 256 bits de entropia)
 * e derivação hierárquica determinística BIP-44 (m/44'/60'/0'/0/0).
 */
export class ViemWalletGenerator implements IWalletGeneratorPort {
  async generateWallet(entropyBits: 128 | 256 = 256): Promise<GeneratedWalletData> {
    // 1. Gera mnemônica BIP-39 com 256 bits de entropia CSPRNG (24 palavras)
    const mnemonic = generateMnemonic(english, entropyBits);

    // 2. Deriva a conta EVM determinística via BIP-44 (caminho canônico: m/44'/60'/0'/0/0)
    const account = mnemonicToAccount(mnemonic, {
      path: "m/44'/60'/0'/0/0",
    });

    // 3. Extrai a chave privada de 32 bytes (256 bits) em formato hexadecimal
    const hdKey = account.getHdKey();
    const privateKey = (hdKey.privateKey ? toHex(hdKey.privateKey) : '') as `0x${string}`;

    return {
      address: account.address,
      privateKey,
      mnemonic,
    };
  }
}

