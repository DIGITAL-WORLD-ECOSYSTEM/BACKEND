export const BSC_MAINNET_CHAIN_ID = 56;

export const DEFAULT_BSC_RPC_URLS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://bsc.nodereal.io',
] as const;

export interface Bep20TokenMetadata {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
}

export const OFFICIAL_BSC_TOKENS: Record<string, Bep20TokenMetadata> = {
  USDT: {
    address: '0x55d398326f99059fF775485246999027B3197955',
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 18,
  },
  BUSD: {
    address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    name: 'Binance-Peg BUSD',
    symbol: 'BUSD',
    decimals: 18,
  },
  USDC: {
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    name: 'Binance-Peg USD Coin',
    symbol: 'USDC',
    decimals: 18,
  },
};

/**
 * ABI Minimalista de alta compatibilidade para tokens BEP-20 (ERC-20 compatível).
 */
export const BEP20_MINIMAL_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
