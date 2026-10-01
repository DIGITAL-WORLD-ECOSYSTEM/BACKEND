import {
  createPublicClient,
  http,
  formatEther,
  formatUnits,
  PublicClient,
} from 'viem';
import { bsc } from 'viem/chains';
import {
  IBscPublicClientPort,
  BnbBalanceResult,
  Bep20BalanceResult,
} from '../../application/ports/blockchain/IBscPublicClientPort';
import {
  BEP20_MINIMAL_ABI,
  DEFAULT_BSC_RPC_URLS,
} from '../../domains/web3/constants/BscConstants';

export interface ViemBscPublicClientOptions {
  rpcUrl?: string;
  customClient?: PublicClient;
  timeoutMs?: number;
}

/**
 * Adaptador de Infraestrutura: ViemBscPublicClientAdapter
 * Conecta aos nós oficiais da Binance Smart Chain (BSC Mainnet - ChainId 56)
 * via JSON-RPC usando a biblioteca Viem.
 */
export class ViemBscPublicClientAdapter implements IBscPublicClientPort {
  private readonly client: PublicClient;

  constructor(options?: ViemBscPublicClientOptions) {
    if (options?.customClient) {
      this.client = options.customClient;
      return;
    }

    const rpcUrl = options?.rpcUrl?.trim() || DEFAULT_BSC_RPC_URLS[0];

    this.client = createPublicClient({
      chain: bsc,
      transport: http(rpcUrl, {
        timeout: options?.timeoutMs ?? 10_000,
        retryCount: 3,
        retryDelay: 1_000,
      }),
    });
  }

  /**
   * Retorna o número do bloco atual na rede BSC.
   */
  async getBlockNumber(): Promise<bigint> {
    try {
      return await this.client.getBlockNumber();
    } catch (error: any) {
      throw new Error(`Falha ao obter número do bloco na BSC: ${error.message}`);
    }
  }

  /**
   * Consulta o saldo em BNB nativo de um endereço EVM.
   */
  async getBnbBalance(address: string): Promise<BnbBalanceResult> {
    try {
      const balanceWei = await this.client.getBalance({
        address: address as `0x${string}`,
      });

      return {
        balanceWei,
        balanceFormatted: formatEther(balanceWei),
      };
    } catch (error: any) {
      throw new Error(`Falha ao consultar saldo BNB para ${address}: ${error.message}`);
    }
  }

  /**
   * Consulta o saldo de um token BEP-20 (ex: USDT) chamando o contrato inteligente via RPC.
   */
  async getBep20Balance(tokenAddress: string, walletAddress: string): Promise<Bep20BalanceResult> {
    try {
      const targetToken = tokenAddress as `0x${string}`;
      const targetWallet = walletAddress as `0x${string}`;

      // Executa as leituras de contrato em paralelo para máxima velocidade
      const [balanceRaw, decimals, symbol, name] = await Promise.all([
        this.client.readContract({
          address: targetToken,
          abi: BEP20_MINIMAL_ABI,
          functionName: 'balanceOf',
          args: [targetWallet],
        }) as Promise<bigint>,
        this.client.readContract({
          address: targetToken,
          abi: BEP20_MINIMAL_ABI,
          functionName: 'decimals',
        }) as Promise<number>,
        this.client.readContract({
          address: targetToken,
          abi: BEP20_MINIMAL_ABI,
          functionName: 'symbol',
        }).catch(() => 'UNKNOWN') as Promise<string>,
        this.client.readContract({
          address: targetToken,
          abi: BEP20_MINIMAL_ABI,
          functionName: 'name',
        }).catch(() => 'Unknown Token') as Promise<string>,
      ]);

      const balanceFormatted = formatUnits(balanceRaw, decimals);

      return {
        tokenAddress,
        symbol,
        name,
        decimals,
        balanceRaw,
        balanceFormatted,
      };
    } catch (error: any) {
      throw new Error(
        `Falha ao consultar saldo BEP-20 do contrato ${tokenAddress} para ${walletAddress}: ${error.message}`
      );
    }
  }

  /**
   * Consulta o recibo de uma transação pelo seu hash on-chain.
   */
  async getTransactionReceipt(hash: string): Promise<any | null> {
    try {
      return await this.client.getTransactionReceipt({
        hash: hash as `0x${string}`,
      });
    } catch (error: any) {
      // Se a transação ainda não foi minerada ou não existe, retorna null
      if (error?.name === 'TransactionReceiptNotFoundError' || error?.message?.includes('not found')) {
        return null;
      }
      throw new Error(`Falha ao consultar recibo da transação ${hash}: ${error.message}`);
    }
  }
}
