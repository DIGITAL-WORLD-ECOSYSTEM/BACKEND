import { describe, it, expect, vi } from 'vitest';
import { SendCustodialTransactionUseCase } from '@/application/use-cases/web3/SendCustodialTransactionUseCase';

describe('SendCustodialTransactionUseCase (Custodial On-Chain Transfer)', () => {
  const masterKey = 'test-master-wallet-encryption-key-32b';
  const validFrom = '0x1111222233334444555566667777888899990000';
  const validTo = '0x2222333344445555666677778888999900001111';
  const dummyPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  const mockWeb3Repo = {
    findByAddress: vi.fn(),
  };

  const mockSecureVaultRepo = {
    findByKeyReference: vi.fn(),
  };

  const mockCryptoVault = {
    decryptEnvelope: vi.fn(),
    decrypt: vi.fn(),
  };

  const mockBscWalletClient = {
    sendNativeBnb: vi.fn(),
    sendBep20Token: vi.fn(),
  };

  const createUseCase = () =>
    new SendCustodialTransactionUseCase(
      mockWeb3Repo as any,
      mockSecureVaultRepo as any,
      mockCryptoVault as any,
      mockBscWalletClient as any,
      masterKey
    );

  it('rejects transfer when user is not the owner of the source wallet', async () => {
    mockWeb3Repo.findByAddress.mockResolvedValueOnce({
      id: 1,
      userId: 99, // Dono diferente
      status: 'active',
      verificationStatus: 'verified',
      provenance: 'internal',
      controlMode: 'platform_key',
      keyReference: 'uuid-vault-1',
    });

    const useCase = createUseCase();
    const result = await useCase.execute({
      userId: 42,
      fromAddress: validFrom,
      toAddress: validTo,
      amount: '0.1',
      assetType: 'BNB',
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Você não possui autorização sobre esta carteira');
  });

  it('rejects transfer when source wallet is external (non-custodial)', async () => {
    mockWeb3Repo.findByAddress.mockResolvedValueOnce({
      id: 1,
      userId: 42,
      status: 'active',
      verificationStatus: 'verified',
      provenance: 'external',
      controlMode: 'external_user',
      keyReference: null,
    });

    const useCase = createUseCase();
    const result = await useCase.execute({
      userId: 42,
      fromAddress: validFrom,
      toAddress: validTo,
      amount: '0.1',
      assetType: 'BNB',
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Apenas carteiras custodiais internas');
  });

  it('decrypts envelope from secure vault and executes native BNB transfer', async () => {
    mockWeb3Repo.findByAddress.mockResolvedValueOnce({
      id: 1,
      userId: 42,
      status: 'active',
      verificationStatus: 'verified',
      provenance: 'internal',
      controlMode: 'platform_key',
      keyReference: 'uuid-vault-1',
    });

    mockSecureVaultRepo.findByKeyReference.mockResolvedValueOnce({
      id: 101,
      ciphertext: 'b64ciphertext==',
      nonce: 'b64nonce12b==',
      authTag: 'b64authtag16b==',
    });

    mockCryptoVault.decryptEnvelope.mockResolvedValueOnce(
      JSON.stringify({ privateKey: dummyPrivateKey, mnemonic: 'abandon ...' })
    );

    mockBscWalletClient.sendNativeBnb.mockResolvedValueOnce({
      txHash: '0xhashbnb123',
      from: validFrom,
      to: validTo,
      amountFormatted: '0.25',
      symbol: 'BNB',
      chainId: 56,
    });

    const useCase = createUseCase();
    const result = await useCase.execute({
      userId: 42,
      fromAddress: validFrom,
      toAddress: validTo,
      amount: '0.25',
      assetType: 'BNB',
    });

    expect(result.isSuccess).toBe(true);
    const data = result.getValue();
    expect(data.txHash).toBe('0xhashbnb123');
    expect(data.amount).toBe('0.25');
    expect(data.asset).toBe('BNB');
    expect(data.explorerUrl).toBe('https://bscscan.com/tx/0xhashbnb123');

    // Valida que o cofre foi desencriptado com os parâmetros corretos
    expect(mockCryptoVault.decryptEnvelope).toHaveBeenCalledWith(
      'b64ciphertext==',
      'b64nonce12b==',
      'b64authtag16b==',
      masterKey
    );
  });

  it('decrypts envelope and executes BEP-20 USDT transfer', async () => {
    mockWeb3Repo.findByAddress.mockResolvedValueOnce({
      id: 2,
      userId: 42,
      status: 'active',
      verificationStatus: 'verified',
      provenance: 'internal',
      controlMode: 'platform_key',
      keyReference: 'uuid-vault-2',
    });

    mockSecureVaultRepo.findByKeyReference.mockResolvedValueOnce({
      id: 102,
      ciphertext: 'b64ciphertext2==',
      nonce: 'b64nonce12b2==',
      authTag: 'b64authtag16b2==',
    });

    mockCryptoVault.decryptEnvelope.mockResolvedValueOnce(
      JSON.stringify({ privateKey: dummyPrivateKey })
    );

    mockBscWalletClient.sendBep20Token.mockResolvedValueOnce({
      txHash: '0xhashusdt456',
      from: validFrom,
      to: validTo,
      amountFormatted: '50',
      symbol: 'BEP20',
      chainId: 56,
    });

    const useCase = createUseCase();
    const result = await useCase.execute({
      userId: 42,
      fromAddress: validFrom,
      toAddress: validTo,
      amount: '50',
      assetType: 'USDT',
    });

    expect(result.isSuccess).toBe(true);
    const data = result.getValue();
    expect(data.txHash).toBe('0xhashusdt456');
    expect(data.amount).toBe('50');
    expect(data.asset).toBe('USDT');
    expect(mockBscWalletClient.sendBep20Token).toHaveBeenCalledWith({
      privateKey: dummyPrivateKey,
      tokenAddress: expect.any(String),
      toAddress: validTo,
      amountToken: '50',
      decimals: 18,
    });
  });
});
