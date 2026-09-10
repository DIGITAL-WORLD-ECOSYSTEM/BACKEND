/**
 * Result<T, E> — Generic discriminated result type.
 *
 * Default: Result<T> === Result<T, string>  (backward compatible)
 * Typed:   Result<T, RepositoryError>       (structured errors for ports)
 *
 * Factories:
 *   Result.ok(value)        → success
 *   Result.fail('message')  → legacy string error (backward compat)
 *   Result.err(e: E)        → structured typed error
 */
export class Result<T, E = string> {
  public readonly isSuccess: boolean;
  public readonly isFailure: boolean;

  public isOk(): boolean {
    return this.isSuccess;
  }

  public isErr(): boolean {
    return this.isFailure;
  }

  /** Legacy string error — only set when created via Result.fail(string|Error). */
  public readonly error: string | null;
  /** Legacy Error object — only set when created via Result.fail(Error). */
  public readonly errorObject: Error | null;
  /** Typed structured error — only set when created via Result.err(E). */
  public readonly typedError: E | null;

  private readonly _value: T | null;

  private constructor(
    isSuccess: boolean,
    legacyError: string | Error | null,
    value: T | null,
    typedError: E | null = null,
  ) {
    this.isSuccess = isSuccess;
    this.isFailure = !isSuccess;

    if (legacyError instanceof Error) {
      this.error = legacyError.message;
      this.errorObject = legacyError;
    } else {
      this.error = legacyError;
      this.errorObject = legacyError ? new Error(legacyError) : null;
    }

    this.typedError = typedError;
    this._value = value;
  }

  public getValue(): T {
    if (!this.isSuccess || this._value === null) {
      throw new Error("Can't get the value of an error result. Use 'error' or 'typedError' instead.");
    }
    return this._value;
  }

  /** Creates a successful result. */
  public static ok<U, F = string>(value?: U): Result<U, F> {
    return new Result<U, F>(true, null, value as U, null);
  }

  /** Creates a failure with a legacy string or Error (backward compatible). */
  public static fail<U, F = string>(error: string | Error): Result<U, F> {
    return new Result<U, F>(false, error, null, null);
  }

  /** Creates a failure with a strongly-typed structured error (e.g. RepositoryError). */
  public static err<U, F>(typedError: F): Result<U, F> {
    const msg = typeof typedError === 'object' && typedError !== null && 'message' in typedError
      ? String((typedError as { message: unknown }).message)
      : String(typedError);
    return new Result<U, F>(false, msg, null, typedError);
  }
}

