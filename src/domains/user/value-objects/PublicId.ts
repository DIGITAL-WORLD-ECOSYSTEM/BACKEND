import { Result } from '../../../shared/kernel/Result';
import { InvalidPublicIdError } from '../errors/UserErrors';

export class PublicId {
  private static readonly EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

  private constructor(private readonly value: string) {}

  /**
   * Constrói e valida um PublicId canônico.
   * No ecossistema W3/BackEnd, o PublicId corresponde estritamente ao endereço EVM canônico em minúsculas.
   */
  public static create(raw: string): Result<PublicId, InvalidPublicIdError> {
    if (!raw || typeof raw !== 'string') {
      return Result.err(new InvalidPublicIdError(String(raw), 'O PublicId não pode ser vazio.'));
    }

    const trimmed = raw.trim();
    if (!this.EVM_ADDRESS_REGEX.test(trimmed)) {
      return Result.err(
        new InvalidPublicIdError(
          trimmed,
          'O PublicId deve ser um endereço hexadecimal canônico válido (ex: 0x followed by 40 hex characters).'
        )
      );
    }

    const normalized = trimmed.toLowerCase();
    return Result.ok(new PublicId(normalized));
  }

  public toString(): string {
    return this.value;
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: PublicId): boolean {
    if (!other) return false;
    return this.value === other.value;
  }
}
