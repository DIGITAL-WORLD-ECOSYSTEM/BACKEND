import { describe, it, expect } from 'vitest';
import {
  EvmAddress,
  ChainNetwork,
  Wallet,
  WalletCreatedDomainEvent,
  InvalidEvmAddressError,
  UnsupportedNetworkError,
  WalletSuspendedError,
} from '@/domains/web3';

describe('Web3 Domain Model (DDD Entities, Value Objects & Events)', () => {
  describe('EvmAddress Value Object', () => {
    it('creates valid EVM address and normalizes to lowercase', () => {
      const raw = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
      const addr = EvmAddress.create(raw);
      expect(addr.value).toBe(raw);
      expect(addr.normalized).toBe(raw.toLowerCase());
      expect(addr.equals(raw.toLowerCase())).toBe(true);
      expect(addr.toString()).toBe(raw);
    });

    it('throws InvalidEvmAddressError for malformed address', () => {
      expect(() => EvmAddress.create('0xinvalid')).toThrow(InvalidEvmAddressError);
      expect(() => EvmAddress.create('')).toThrow(InvalidEvmAddressError);
      expect(() => EvmAddress.create('0x123')).toThrow(InvalidEvmAddressError);
    });

    it('validates address format via static isValid helper', () => {
      expect(EvmAddress.isValid('0x1111222233334444555566667777888899990000')).toBe(true);
      expect(EvmAddress.isValid('not-an-address')).toBe(false);
    });
  });

  describe('ChainNetwork Value Object', () => {
    it('loads supported chain metadata (BSC 56, Ethereum 1, Polygon 137)', () => {
      const bsc = ChainNetwork.fromId(56);
      expect(bsc.chainId).toBe(56);
      expect(bsc.name).toBe('BNB Smart Chain');
      expect(bsc.symbol).toBe('BNB');
      expect(bsc.metadata.isTestnet).toBe(false);

      const eth = ChainNetwork.fromId(1);
      expect(eth.chainId).toBe(1);
      expect(eth.symbol).toBe('ETH');
    });

    it('throws UnsupportedNetworkError for unconfigured chain', () => {
      expect(() => ChainNetwork.fromId(999999)).toThrow(UnsupportedNetworkError);
    });
  });

  describe('Wallet Domain Entity', () => {
    it('encapsulates lifecycle state transitions and invariants', () => {
      const addr = EvmAddress.create('0x1111222233334444555566667777888899990000');
      const wallet = new Wallet({
        id: 1,
        userId: 42,
        provenance: 'internal',
        networkId: 56,
        walletType: 'eoa',
        controlMode: 'platform_key',
        address: addr,
        label: 'My BSC Wallet',
        status: 'active',
        verificationStatus: 'verified',
        isPrimary: true,
        linkedAt: new Date(),
        version: 1,
      });

      expect(wallet.id).toBe(1);
      expect(wallet.userId).toBe(42);
      expect(wallet.isUsable()).toBe(true);
      expect(() => wallet.assertUsable()).not.toThrow();

      // Transição de estado para suspenso
      wallet.suspend();
      expect(wallet.status).toBe('suspended');
      expect(wallet.isUsable()).toBe(false);
      expect(() => wallet.assertUsable()).toThrow(WalletSuspendedError);

      // Reativação
      wallet.activate();
      expect(wallet.status).toBe('active');
      expect(wallet.isUsable()).toBe(true);
    });
  });

  describe('WalletCreatedDomainEvent', () => {
    it('constructs with correct event name and aggregate ID', () => {
      const event = new WalletCreatedDomainEvent({
        walletId: 10,
        userId: 42,
        address: '0x1111222233334444555566667777888899990000',
        networkId: 56,
        provenance: 'internal',
        isPrimary: true,
      });

      expect(event.eventName).toBe('Web3.WalletCreated.v1');
      expect(event.getAggregateId()).toBe('10');
      expect(event.dateTimeOccurred).toBeInstanceOf(Date);
    });
  });
});
