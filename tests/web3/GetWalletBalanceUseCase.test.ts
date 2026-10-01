import { describe, it, expect, vi } from 'vitest';
import { GetWalletBalanceUseCase } from '@/application/use-cases/web3/GetWalletBalanceUseCase';
import { OFFICIAL_BSC_TOKENS } from '@/domains/web3/constants/BscConstants';

describe('GetWalletBalanceUseCase (On-Chain Balance Query)', () => {
  const validAddress = '0x1111222233334444555566667777888899990000';

  const mockBscClient = {
    getBlockNumber: vi.fn().mockResolvedValue(125000000n),
    getBnbBalance: vi.fn().mockResolvedValue({
      balanceWei: 2500000000000000000n, // 2.5 BNB
      balanceFormatted: '2.5',
    }),
    getBep20Balance: vi.fn().mockResolvedValue({
      tokenAddress: OFFICIAL_BSC_TOKENS.USDT.address,
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 18,
      balanceRaw: 500000000000000000000n, // 500 USDT
      balanceFormatted: '500',
    }),
    getTransactionReceipt: vi.fn(),
  };

  it('rejects invalid EVM address format', async () => {
    const useCase = new GetWalletBalanceUseCase(mockBscClient as any);
    const res = await useCase.execute({ address: 'invalid-address' });

    expect(res.isFailure).toBe(true);
    expect(res.error).toContain('Endereço EVM inválido');
  });

  it('queries and consolidates native BNB and BEP-20 USDT balances', async () => {
    const useCase = new GetWalletBalanceUseCase(mockBscClient as any);
    const res = await useCase.execute({ address: validAddress });

    expect(res.isSuccess).toBe(true);
    const data = res.getValue();

    expect(data.address).toBe(validAddress);
    expect(data.addressNormalized).toBe(validAddress.toLowerCase());
    expect(data.network.chainId).toBe(56);
    expect(data.network.name).toBe('BNB Smart Chain');

    // Saldo Nativo
    expect(data.native.symbol).toBe('BNB');
    expect(data.native.balanceFormatted).toBe('2.5');
    expect(data.native.balanceWei).toBe('2500000000000000000');

    // Tokens
    expect(data.tokens).toHaveLength(1);
    expect(data.tokens[0].symbol).toBe('USDT');
    expect(data.tokens[0].name).toBe('Tether USD');
    expect(data.tokens[0].balanceFormatted).toBe('500');
    expect(data.tokens[0].decimals).toBe(18);
  });

  it('handles token query error gracefully and still returns BNB balance', async () => {
    const faultyBscClient = {
      ...mockBscClient,
      getBep20Balance: vi.fn().mockRejectedValue(new Error('Token contract execution reverted')),
    };

    const useCase = new GetWalletBalanceUseCase(faultyBscClient as any);
    const res = await useCase.execute({ address: validAddress });

    expect(res.isSuccess).toBe(true);
    const data = res.getValue();
    expect(data.native.balanceFormatted).toBe('2.5');
    expect(data.tokens).toHaveLength(0); // Falha de um token não quebra o saldo nativo
  });

  it('returns failure when native BNB query fails', async () => {
    const brokenBscClient = {
      ...mockBscClient,
      getBnbBalance: vi.fn().mockRejectedValue(new Error('RPC Provider unreachable')),
    };

    const useCase = new GetWalletBalanceUseCase(brokenBscClient as any);
    const res = await useCase.execute({ address: validAddress });

    expect(res.isFailure).toBe(true);
    expect(res.error).toContain('Falha ao consultar saldo on-chain na BSC');
  });
});
