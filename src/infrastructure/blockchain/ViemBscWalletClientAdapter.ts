import {
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import {
  IBscWalletClientPort,
  SendBnbParams,
  SendBep20Params,
  SendTransactionResult,
} from '../../application/ports/blockchain/IBscWalletClientPort';
import {
  BEP20_MINIMAL_ABI,
  DEFAULT_BSC_RPC_URLS,
  BSC_MAINNET_CHAIN_ID,
} from '../../domains/web3/constants/BscConstants';

export interface ViemBscWalletClientOptions {
  rpcUrl?: string;
  customClient?: WalletClient;
  timeoutMs?: number;
}

/**
 * Adaptador de Infraestrutura: ViemBscWalletClientAdapter
 * Assina e transmite transações para a rede Binance Smart Chain (BSC Mainnet)
 * utilizando contas derivadas de chaves privadas em memória.
 */
export class ViemBscWalletClientAdapter implements IBscWalletClientPort {
  private readonly client: WalletClient;
  private readonly chainId = BSC_MAINNET_CHAIN_ID;

  constructor(options?: ViemBscWalletClientOptions) {
    if (options?.customClient) {
      this.client = options.customClient;
      return;
    }

    const rpcUrl = options?.rpcUrl?.trim() || DEFAULT_BSC_RPC_URLS[0];

    this.client = createWalletClient({
      chain: bsc,
      transport: http(rpcUrl, {
        timeout: options?.timeoutMs ?? 15_000,
        retryCount: 2,
        retryDelay: 1_000,
      }),
    });
  }

  /**
   * Assina e envia BNB nativo para outro endereço.
   */
  async sendNativeBnb(params: SendBnbParams): Promise<SendTransactionResult> {
    try {
      const account = privateKeyToAccount(params.privateKey);
      const value = parseEther(params.amountBnb);

      const txHash = await this.client.sendTransaction({
        account,
        to: params.toAddress,
        value,
        chain: bsc,
      });

      return {
        txHash,
        from: account.address,
        to: params.toAddress,
        amountFormatted: params.amountBnb,
        symbol: 'BNB',
        chainId: this.chainId,
      };
    } catch (error: any) {
      throw new Error(`Falha ao transmitir transferência de BNB na BSC: ${error.message}`);
    }
  }

  /**
   * Assina e envia tokens BEP-20 (ex: USDT) invocando a função 'transfer' do contrato inteligente.
   */
  async sendBep20Token(params: SendBep20Params): Promise<SendTransactionResult> {
    try {
      const account = privateKeyToAccount(params.privateKey);
      const decimals = params.decimals ?? 18;
      const amountRaw = parseUnits(params.amountToken, decimals);

      const txHash = await this.client.writeContract({
        account,
        address: params.tokenAddress,
        abi: BEP20_MINIMAL_ABI,
        functionName: 'transfer',
        args: [params.toAddress, amountRaw],
        chain: bsc,
      });

      return {
        txHash,
        from: account.address,
        to: params.toAddress,
        amountFormatted: params.amountToken,
        symbol: 'BEP20',
        chainId: this.chainId,
      };
    } catch (error: any) {
      throw new Error(`Falha ao transmitir transferência BEP-20 na BSC: ${error.message}`);
    }
  }
}
