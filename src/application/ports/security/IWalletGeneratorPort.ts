export interface GeneratedWalletData {
  /**
   * O endereço público normalizado gerado (0x...).
   */
  address: string;
  
  /**
   * A chave privada raw (0x...) que DEVE ser enviada imediatamente ao Secure Vault.
   */
  privateKey: string;

  /**
   * A frase mnemônica BIP-39 oficial de 24 palavras (256 bits de entropia CSPRNG).
   */
  mnemonic: string;
}

export interface IWalletGeneratorPort {
  /**
   * Gera uma nova carteira Web3 baseada no padrão BIP-39 (24 palavras) e BIP-44.
   * 
   * @param entropyBits Tamanho da entropia em bits (padrão 256 para 24 palavras).
   * @returns Os dados gerados da carteira contendo endereço público, chave privada e frase mnemônica.
   */
  generateWallet(entropyBits?: 128 | 256): Promise<GeneratedWalletData>;
}

