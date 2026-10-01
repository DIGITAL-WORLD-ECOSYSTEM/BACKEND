import { IBscPublicClientPort } from '../../ports/blockchain/IBscPublicClientPort';
import { EvmAddress } from '../../../domains/web3/value-objects/EvmAddress';
import { OFFICIAL_BSC_TOKENS, BSC_MAINNET_CHAIN_ID } from '../../../domains/web3/constants/BscConstants';
import { Result } from '../../../shared/kernel/Result';

export interface GetWalletBalanceInputDTO {
  address: string;
  customTokenAddresses?: string[];
}

export interface TokenBalanceDTO {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: string;
  balanceFormatted: string;
}

export interface WalletBalanceOutputDTO {
  address: string;
  addressNormalized: string;
  network: {
    chainId: number;
    name: string;
    symbol: string;
  };
  native: {
    symbol: string;
    name: string;
    balanceWei: string;
    balanceFormatted: string;
  };
  tokens: TokenBalanceDTO[];
  updatedAt: Date;
}

/**
 * Caso de Uso: Consultar Saldo On-Chain da Carteira na Binance Smart Chain (BSC).
 * Realiza a leitura em tempo real nos nós validadores, consolidando o saldo nativo em BNB
 * e os saldos de tokens oficiais BEP-20 (ex: USDT).
 */
export class GetWalletBalanceUseCase {
  constructor(private readonly bscClient: IBscPublicClientPort) {}

  async execute(input: GetWalletBalanceInputDTO): Promise<Result<WalletBalanceOutputDTO>> {
    try {
      if (!input.address || !EvmAddress.isValid(input.address)) {
        return Result.fail('Endereço EVM inválido. O formato deve ser 0x seguido de 40 caracteres hexadecimais.');
      }

      const evmAddress = EvmAddress.create(input.address);
      const targetAddress = evmAddress.value;

      // Lista de tokens a consultar (USDT oficial por padrão + tokens customizados se houver)
      const tokenAddressesToQuery = [
        OFFICIAL_BSC_TOKENS.USDT.address,
        ...(input.customTokenAddresses || []).filter(EvmAddress.isValid),
      ];

      // Remove duplicatas
      const uniqueTokens = Array.from(new Set(tokenAddressesToQuery.map((t) => t.toLowerCase())));

      // 1. Consulta saldo nativo (BNB) e saldos BEP-20 em paralelo
      const [bnbResult, tokenResults] = await Promise.all([
        this.bscClient.getBnbBalance(targetAddress),
        Promise.all(
          uniqueTokens.map(async (tokenAddr) => {
            try {
              return await this.bscClient.getBep20Balance(tokenAddr, targetAddress);
            } catch (err: any) {
              console.warn(`[GetWalletBalanceUseCase] Falha ao consultar token ${tokenAddr}:`, err?.message);
              return null;
            }
          })
        ),
      ]);

      const formattedTokens: TokenBalanceDTO[] = tokenResults
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .map((t) => ({
          tokenAddress: t.tokenAddress,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          balanceRaw: t.balanceRaw.toString(),
          balanceFormatted: t.balanceFormatted,
        }));

      return Result.ok<WalletBalanceOutputDTO>({
        address: targetAddress,
        addressNormalized: evmAddress.normalized,
        network: {
          chainId: BSC_MAINNET_CHAIN_ID,
          name: 'BNB Smart Chain',
          symbol: 'BNB',
        },
        native: {
          symbol: 'BNB',
          name: 'Build and Build (BNB)',
          balanceWei: bnbResult.balanceWei.toString(),
          balanceFormatted: bnbResult.balanceFormatted,
        },
        tokens: formattedTokens,
        updatedAt: new Date(),
      });
    } catch (error: any) {
      return Result.fail(`Falha ao consultar saldo on-chain na BSC: ${error.message}`);
    }
  }
}
