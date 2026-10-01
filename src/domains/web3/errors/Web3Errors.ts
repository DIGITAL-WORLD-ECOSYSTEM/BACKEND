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

export class WalletNotFoundError extends Web3DomainError {
  constructor(identifier: string | number) {
    super(`Carteira '${identifier}' não foi encontrada.`);
    this.name = 'WalletNotFoundError';
  }
}

export class WalletOwnershipError extends Web3DomainError {
  constructor(address: string) {
    super(`A carteira ${address} não pertence ao usuário autenticado.`);
    this.name = 'WalletOwnershipError';
  }
}

export class WalletAlreadyLinkedError extends Web3DomainError {
  constructor(address: string) {
    super(`A carteira Web3 ${address} já está vinculada a outra conta.`);
    this.name = 'WalletAlreadyLinkedError';
  }
}

export class InvalidSiweSignatureError extends Web3DomainError {
  constructor(reason?: string) {
    super(reason ? `Assinatura SIWE EIP-4361 inválida: ${reason}` : 'Assinatura SIWE EIP-4361 inválida ou forjada.');
    this.name = 'InvalidSiweSignatureError';
  }
}

export class ExpiredChallengeError extends Web3DomainError {
  constructor() {
    super('O desafio Web3 (challenge/nonce) expirou, é inválido ou já foi utilizado.');
    this.name = 'ExpiredChallengeError';
  }
}

export class AntiLockoutViolationError extends Web3DomainError {
  constructor() {
    super('Não é permitido remover a única credencial de acesso/identidade da conta (Violação da Trava Anti-Lockout).');
    this.name = 'AntiLockoutViolationError';
  }
}

