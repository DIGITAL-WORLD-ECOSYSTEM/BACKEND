import { describe, it, expect } from 'vitest';
import { ViemBscPublicClientAdapter } from '@/infrastructure/blockchain/ViemBscPublicClientAdapter';
import { OFFICIAL_BSC_TOKENS } from '@/domains/web3/constants/BscConstants';

describe('Live BSC Mainnet Integration Test (Real On-Chain Query)', () => {
  // Binance Hot Wallet 8 (um dos maiores endereços públicos na BSC Mainnet)
  const targetWallet = '0xF977814e90dA44bFA03b6295A0616a897441aceC';
  const usdtContract = OFFICIAL_BSC_TOKENS.USDT.address;

  it('connects to real Binance Smart Chain Mainnet and queries live block, BNB and USDT', async () => {
    const adapter = new ViemBscPublicClientAdapter();

    console.log('\n--- INICIANDO CONSULTA REAL NA BINANCE SMART CHAIN (MAINNET) ---');

    // 1. Consulta Bloco Real
    const blockNumber = await adapter.getBlockNumber();
    console.log(`[BSC LIVE] Bloco mais recente da rede: #${blockNumber.toString()}`);
    expect(blockNumber).toBeGreaterThan(30000000n);

    // 2. Consulta Saldo Real em BNB
    const bnbResult = await adapter.getBnbBalance(targetWallet);
    console.log(`[BSC LIVE] Endereço consultado: ${targetWallet}`);
    console.log(`[BSC LIVE] Saldo Real BNB: ${bnbResult.balanceFormatted} BNB (Wei: ${bnbResult.balanceWei.toString()})`);
    expect(bnbResult.balanceWei).toBeGreaterThanOrEqual(0n);
    expect(Number(bnbResult.balanceFormatted)).toBeGreaterThan(0);

    // 3. Consulta Saldo Real em USDT (BEP-20)
    const usdtResult = await adapter.getBep20Balance(usdtContract, targetWallet);
    console.log(`[BSC LIVE] Token Consultado: ${usdtResult.name} (${usdtResult.symbol})`);
    console.log(`[BSC LIVE] Contrato USDT: ${usdtResult.tokenAddress}`);
    console.log(`[BSC LIVE] Decimais: ${usdtResult.decimals}`);
    console.log(`[BSC LIVE] Saldo Real USDT: $${usdtResult.balanceFormatted}`);
    console.log('--- CONSULTA CONCLUÍDA COM SUCESSO ABSOLUTO ---\n');

    expect(usdtResult.symbol).toBe('USDT');
    expect(usdtResult.name).toBe('Tether USD');
    expect(usdtResult.decimals).toBe(18);
    expect(Number(usdtResult.balanceFormatted)).toBeGreaterThan(0);
  }, 15000);

  it('queries a brand-new internal custodial wallet (generated with 24 words) on live BSC Mainnet', async () => {
    const { ViemWalletGenerator } = await import('@/infrastructure/security/crypto/ViemWalletGenerator');
    const generator = new ViemWalletGenerator();
    const newWallet = await generator.generateWallet(256); // 24 palavras

    const adapter = new ViemBscPublicClientAdapter();

    console.log('\n--- CONSULTA DE CARTEIRA RECÉM-GERADA (24 PALAVRAS) NA BSC MAINNET ---');
    console.log(`[NOVA CARTEIRA] Endereço Gerado: ${newWallet.address}`);
    console.log(`[NOVA CARTEIRA] Mnemônica (24 palavras): ${newWallet.mnemonic}`);

    // Consulta na blockchain real
    const bnbBalance = await adapter.getBnbBalance(newWallet.address);
    const usdtBalance = await adapter.getBep20Balance(usdtContract, newWallet.address);

    console.log(`[SALDO ON-CHAIN BSC] BNB: ${bnbBalance.balanceFormatted} BNB`);
    console.log(`[SALDO ON-CHAIN BSC] USDT: $${usdtBalance.balanceFormatted}`);
    console.log('--- RECONHECIMENTO ON-CHAIN BEM-SUCEDIDO ---\n');

    expect(bnbBalance.balanceWei).toBe(0n);
    expect(bnbBalance.balanceFormatted).toBe('0');
    expect(usdtBalance.balanceRaw).toBe(0n);
    expect(usdtBalance.balanceFormatted).toBe('0');
  }, 15000);
});
