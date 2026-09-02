export class Result<T> {
  public readonly isSuccess: boolean;
  public readonly isFailure: boolean;
  public readonly error: string | null;
  public readonly errorObject: Error | null;
  private readonly _value: T | null;

  private constructor(isSuccess: boolean, error: string | Error | null, value: T | null) {
    if (isSuccess && error) {
      throw new Error("InvalidOperation: A result cannot be successful and contain an error");
    }
    if (!isSuccess && !error) {
      throw new Error("InvalidOperation: A failing result needs to contain an error message");
    }
    this.isSuccess = isSuccess;
    this.isFailure = !isSuccess;
    if (error instanceof Error) {
      this.error = error.message;
      this.errorObject = error;
    } else {
      this.error = error;
      this.errorObject = error ? new Error(error) : null;
    }
    this._value = value;
  }

  public getValue(): T {
    if (!this.isSuccess || this._value === null) {
      throw new Error("Can't get the value of an error result. Use 'error' instead.");
    }
    return this._value;
  }

  public static ok<U>(value?: U): Result<U> {
    return new Result<U>(true, null, value as U);
  }

  public static fail<U>(error: string | Error): Result<U> {
    return new Result<U>(false, error, null);
  }
}
