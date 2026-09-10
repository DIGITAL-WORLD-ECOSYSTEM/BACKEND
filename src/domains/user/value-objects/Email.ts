import { Result } from '../../../shared/kernel/Result';

export class InvalidEmailError extends Error {
  public readonly code = 'INVALID_EMAIL';
  constructor(email: string, reason: string = 'Formato de email inválido.') {
    super(`Email inválido "${email}": ${reason}`);
    this.name = 'InvalidEmailError';
  }
}

export class Email {
  // RFC-5322 compliant regex with at least 2 characters top-level domain
  private static readonly EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

  private constructor(
    private readonly rawValue: string,
    private readonly normalizedValue: string
  ) {}

  public static create(raw: string): Result<Email, InvalidEmailError> {
    if (!raw || typeof raw !== 'string') {
      return Result.err(new InvalidEmailError(String(raw), 'O email não pode ser vazio.'));
    }

    const trimmed = raw.trim();
    if (trimmed.length < 6 || trimmed.length > 254) {
      return Result.err(new InvalidEmailError(trimmed, 'O comprimento do email deve ter entre 6 e 254 caracteres.'));
    }

    if (!this.EMAIL_REGEX.test(trimmed)) {
      return Result.err(new InvalidEmailError(trimmed, 'O email não atende ao padrão canônico RFC-5322.'));
    }

    const normalized = trimmed.toLowerCase();
    return Result.ok(new Email(trimmed, normalized));
  }

  public getRaw(): string {
    return this.rawValue;
  }

  public getNormalized(): string {
    return this.normalizedValue;
  }

  public toString(): string {
    return this.normalizedValue;
  }

  public equals(other: Email): boolean {
    if (!other) return false;
    return this.normalizedValue === other.normalizedValue;
  }
}
