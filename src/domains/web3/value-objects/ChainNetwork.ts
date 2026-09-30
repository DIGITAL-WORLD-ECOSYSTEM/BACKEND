import { UnsupportedNetworkError } from '../errors/Web3Errors';

export interface ChainMetadata {
  chainId: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  isTestnet: boolean;
}

export const SUPPORTED_CHAINS: Record<number, ChainMetadata> = {
  56: {
    chainId: 56,
    name: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io'],
    blockExplorerUrls: ['https://bscscan.com'],
    isTestnet: false,
  },
  97: {
    chainId: 97,
    name: 'BNB Smart Chain Testnet',
    nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
    rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
    isTestnet: true,
  },
  1: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://cloudflare-eth.com'],
    blockExplorerUrls: ['https://etherscan.io'],
    isTestnet: false,
  },
  137: {
    chainId: 137,
    name: 'Polygon Mainnet',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
    isTestnet: false,
  },
};

/**
 * Value Object: ChainNetwork
 * Representa e valida uma rede blockchain suportada pelo ecossistema.
 */
export class ChainNetwork {
  private readonly _metadata: ChainMetadata;

  private constructor(chainId: number) {
    const meta = SUPPORTED_CHAINS[chainId];
    if (!meta) {
      throw new UnsupportedNetworkError(chainId);
    }
    this._metadata = meta;
  }

  public static fromId(chainId: number): ChainNetwork {
    return new ChainNetwork(chainId);
  }

  public static isSupported(chainId: number): boolean {
    return Boolean(SUPPORTED_CHAINS[chainId]);
  }

  public get chainId(): number {
    return this._metadata.chainId;
  }

  public get name(): string {
    return this._metadata.name;
  }

  public get symbol(): string {
    return this._metadata.nativeCurrency.symbol;
  }

  public get metadata(): Readonly<ChainMetadata> {
    return this._metadata;
  }
}
