export class IdentityNotLinkedError extends Error {
  readonly code = 'IDENTITY_NOT_LINKED';

  constructor(message: string = 'Identidade não vinculada a nenhuma conta existente.') {
    super(message);
    this.name = 'IdentityNotLinkedError';
  }
}
