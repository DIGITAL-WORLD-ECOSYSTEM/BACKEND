import { describe, it, expect, vi } from 'vitest';
import { ViemBscWalletClientAdapter } from '@/infrastructure/blockchain/ViemBscWalletClientAdapter';
import { OFFICIAL_BSC_TOKENS } from '@/domains/web3/constants/BscConstants';

describe('ViemBscWalletClientAdapter (Transaction Signing & Broadcast)', () => {
  // Chave privada de teste descartável (32 bytes hex)
  const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const;
  const recipientAddress = '0x2222333344445555666677778888999900001111' as const;

  it('signs and broadcasts native BNB transfer returning txHash and recipient', async () => {
    const mockClient = {
      sendTransaction: vi.fn().mockResolvedValue('0xhashbnb123456789' as `0x${string}`),
    };

    const adapter = new ViemBscWalletClientAdapter({
      customClient: mockClient as any,
    });

    const result = await adapter.sendNativeBnb({
      privateKey: testPrivateKey,
      toAddress: recipientAddress,
      amountBnb: '0.5',
    });

    expect(mockClient.sendTransaction).toHaveBeenCalledTimes(1);
    expect(result.txHash).toBe('0xhashbnb123456789');
    expect(result.to).toBe(recipientAddress);
    expect(result.symbol).toBe('BNB');
    expect(result.amountFormatted).toBe('0.5');
    expect(result.chainId).toBe(56);
  });

  it('signs and broadcasts BEP-20 token transfer (USDT) calling writeContract', async () => {
    const mockClient = {
      writeContract: vi.fn().mockResolvedValue('0xhashusdt987654321' as `0x${string}`),
    };

    const adapter = new ViemBscWalletClientAdapter({
      customClient: mockClient as any,
    });

    const result = await adapter.sendBep20Token({
      privateKey: testPrivateKey,
      tokenAddress: OFFICIAL_BSC_TOKENS.USDT.address,
      toAddress: recipientAddress,
      amountToken: '100',
      decimals: 18,
    });

    expect(mockClient.writeContract).toHaveBeenCalledTimes(1);
    expect(result.txHash).toBe('0xhashusdt987654321');
    expect(result.to).toBe(recipientAddress);
    expect(result.amountFormatted).toBe('100');
    expect(result.chainId).toBe(56);
  });

  it('wraps Viem execution errors in descriptive error messages', async () => {
    const mockClient = {
      sendTransaction: vi.fn().mockRejectedValue(new Error('insufficient funds for gas * price + value')),
    };

    const adapter = new ViemBscWalletClientAdapter({
      customClient: mockClient as any,
    });

    await expect(
      adapter.sendNativeBnb({
        privateKey: testPrivateKey,
        toAddress: recipientAddress,
        amountBnb: '1000',
      })
    ).rejects.toThrow('Falha ao transmitir transferência de BNB na BSC: insufficient funds');
  });
});
