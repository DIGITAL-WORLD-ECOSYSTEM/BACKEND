import { describe, it, expect, vi } from 'vitest';
import { ViemBscPublicClientAdapter } from '@/infrastructure/blockchain/ViemBscPublicClientAdapter';
import { OFFICIAL_BSC_TOKENS } from '@/domains/web3/constants/BscConstants';

describe('ViemBscPublicClientAdapter (BSC RPC Public Client)', () => {
  const testWallet = '0x1111222233334444555566667777888899990000';
  const usdtContract = OFFICIAL_BSC_TOKENS.USDT.address;

  it('instantiates successfully with default Binance RPC without throwing', () => {
    const adapter = new ViemBscPublicClientAdapter();
    expect(adapter).toBeInstanceOf(ViemBscPublicClientAdapter);
  });

  it('queries native BNB balance and correctly formats Wei to BNB string', async () => {
    const mockClient = {
      getBalance: vi.fn().mockResolvedValue(1500000000000000000n), // 1.5 BNB
    };

    const adapter = new ViemBscPublicClientAdapter({
      customClient: mockClient as any,
    });

    const result = await adapter.getBnbBalance(testWallet);
    expect(mockClient.getBalance).toHaveBeenCalledWith({
      address: testWallet,
    });
    expect(result.balanceWei).toBe(1500000000000000000n);
    expect(result.balanceFormatted).toBe('1.5');
  });

  it('queries BEP-20 token balance (USDT) calling balanceOf and decimals and formats correctly', async () => {
    const mockClient = {
      readContract: vi.fn(async ({ functionName }) => {
        if (functionName === 'balanceOf') return 250000000000000000000n; // 250 USDT (18 decimals)
        if (functionName === 'decimals') return 18;
        if (functionName === 'symbol') return 'USDT';
        if (functionName === 'name') return 'Tether USD';
        throw new Error(`Unexpected function ${functionName}`);
      }),
    };

    const adapter = new ViemBscPublicClientAdapter({
      customClient: mockClient as any,
    });

    const result = await adapter.getBep20Balance(usdtContract, testWallet);
    expect(result.tokenAddress).toBe(usdtContract);
    expect(result.symbol).toBe('USDT');
    expect(result.name).toBe('Tether USD');
    expect(result.decimals).toBe(18);
    expect(result.balanceRaw).toBe(250000000000000000000n);
    expect(result.balanceFormatted).toBe('250');
  });

  it('fetches block number from BSC network', async () => {
    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(38500000n),
    };

    const adapter = new ViemBscPublicClientAdapter({
      customClient: mockClient as any,
    });

    const blockNumber = await adapter.getBlockNumber();
    expect(blockNumber).toBe(38500000n);
  });

  it('returns null when transaction receipt is not found or pending', async () => {
    const notFoundError = new Error('Transaction receipt not found');
    notFoundError.name = 'TransactionReceiptNotFoundError';

    const mockClient = {
      getTransactionReceipt: vi.fn().mockRejectedValue(notFoundError),
    };

    const adapter = new ViemBscPublicClientAdapter({
      customClient: mockClient as any,
    });

    const receipt = await adapter.getTransactionReceipt('0x123456');
    expect(receipt).toBeNull();
  });

  it('wraps RPC connection failures in descriptive errors without throwing unhandled exceptions', async () => {
    const mockClient = {
      getBalance: vi.fn().mockRejectedValue(new Error('Connection timed out to RPC')),
    };

    const adapter = new ViemBscPublicClientAdapter({
      customClient: mockClient as any,
    });

    await expect(adapter.getBnbBalance(testWallet)).rejects.toThrow(
      'Falha ao consultar saldo BNB para 0x1111222233334444555566667777888899990000: Connection timed out to RPC'
    );
  });
});
