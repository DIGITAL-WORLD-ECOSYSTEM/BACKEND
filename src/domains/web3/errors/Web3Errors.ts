export class Web3DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Web3DomainError';
  }
}

export class InvalidEvmAddressError extends Web3DomainError {
  constructor(address: string) {
    super(`Endereço EVM inválido: '${address}'. Deve seguir o formato hexadecimal 0x de 40 caracteres.`);
    this.name = 'InvalidEvmAddressError';
  }
}

export class UnsupportedNetworkError extends Web3DomainError {
  constructor(networkId: number) {
    super(`Rede blockchain não suportada: ID ${networkId}.`);
    this.name = 'UnsupportedNetworkError';
  }
}

export class WalletSuspendedError extends Web3DomainError {
  constructor(walletId: number) {
    super(`A carteira #${walletId} está suspensa ou revogada e não pode realizar operações.`);
    this.name = 'WalletSuspendedError';
  }
}
