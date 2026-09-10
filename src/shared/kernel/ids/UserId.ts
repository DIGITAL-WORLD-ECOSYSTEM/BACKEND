import { Result } from '../Result';

export class InvalidUserIdError extends Error {
  public readonly code = 'INVALID_USER_ID';
  constructor(message: string = 'O ID de usuário fornecido é inválido. Deve ser um número inteiro positivo.') {
    super(message);
    this.name = 'InvalidUserIdError';
  }
}

/**
 * Branded Type for Canonical UserId
 * Prevents domain coupling while maintaining strong type safety across Bounded Contexts.
 */
export type UserId = number & { readonly __brand: unique symbol };

export function createUserId(id: number): Result<UserId, InvalidUserIdError> {
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Result.err(new InvalidUserIdError(`ID de usuário inválido: ${id}. Deve ser um inteiro positivo.`));
  }
  return Result.ok(id as UserId);
}

export function fromTrustedUserId(id: number): UserId {
  return id as UserId;
}
