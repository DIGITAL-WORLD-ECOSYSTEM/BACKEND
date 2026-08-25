export class AntiLockoutViolationError extends Error {
  readonly code = 'ANTI_LOCKOUT_VIOLATION';

  constructor(message: string = 'Não é possível remover a última credencial de autenticação da conta.') {
    super(message);
    this.name = 'AntiLockoutViolationError';
  }
}
