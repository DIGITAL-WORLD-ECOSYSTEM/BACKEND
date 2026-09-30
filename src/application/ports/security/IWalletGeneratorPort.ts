export interface GeneratedWalletData {
  /**
   * O endereço público normalizado gerado (0x...).
   */
  address: string;
  
  /**
   * A chave privada raw (0x...) que DEVE ser enviada imediatamente ao Secure Vault.
   */
  privateKey: string;
}

export interface IWalletGeneratorPort {
  /**
   * Gera uma nova carteira Web3 com entropia forte (CSPRNG).
   * 
   * @returns Os dados gerados da carteira contendo endereço público e chave privada.
   */
  generateWallet(): Promise<GeneratedWalletData>;
}
