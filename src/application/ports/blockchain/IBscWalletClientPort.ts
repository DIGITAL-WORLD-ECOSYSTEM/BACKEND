export interface SendBnbParams {
  privateKey: `0x${string}`;
  toAddress: `0x${string}`;
  amountBnb: string;
}

export interface SendBep20Params {
  privateKey: `0x${string}`;
  tokenAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountToken: string;
  decimals?: number;
}

export interface SendTransactionResult {
  txHash: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  amountFormatted: string;
  symbol: string;
  chainId: number;
}

/**
 * Port de Aplicação: Cliente de Assinatura e Transmissão na Binance Smart Chain (BSC).
 * Executa transferências on-chain utilizando uma chave privada transitória em memória.
 */
export interface IBscWalletClientPort {
  /**
   * Assina e envia uma transferência de moeda nativa (BNB).
   */
  sendNativeBnb(params: SendBnbParams): Promise<SendTransactionResult>;

  /**
   * Assina e envia uma transferência de token BEP-20 (ex: USDT).
   */
  sendBep20Token(params: SendBep20Params): Promise<SendTransactionResult>;
}
