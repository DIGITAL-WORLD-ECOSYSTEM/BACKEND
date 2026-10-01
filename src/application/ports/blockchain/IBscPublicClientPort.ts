export interface BnbBalanceResult {
  balanceWei: bigint;
  balanceFormatted: string;
}

export interface Bep20BalanceResult {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: bigint;
  balanceFormatted: string;
}

/**
 * Port de Aplicação: Cliente Público de Leitura da Binance Smart Chain (BSC).
 * Desacopla as camadas de aplicação dos detalhes técnicos da biblioteca Viem e nós RPC.
 */
export interface IBscPublicClientPort {
  /**
   * Retorna o número do bloco mais recente minerado/validado na rede BSC.
   */
  getBlockNumber(): Promise<bigint>;

  /**
   * Consulta o saldo da moeda nativa (BNB) de uma carteira.
   * Retorna tanto o valor exato em Wei (bigint) quanto o valor legível formatado (string).
   */
  getBnbBalance(address: string): Promise<BnbBalanceResult>;

  /**
   * Consulta o saldo de um Smart Contract BEP-20 (ex: USDT) chamando 'balanceOf' e 'decimals'.
   */
  getBep20Balance(tokenAddress: string, walletAddress: string): Promise<Bep20BalanceResult>;

  /**
   * Consulta o recibo de confirmação de uma transação on-chain pelo seu hash.
   */
  getTransactionReceipt(hash: string): Promise<any | null>;
}
