export class InvalidUserStatusError extends Error {
  public readonly code = 'INVALID_USER_STATUS';
  constructor(status: string) {
    super(`Status de usuário inválido: "${status}".`);
    this.name = 'InvalidUserStatusError';
  }
}

export class InvalidUserStatusTransitionError extends Error {
  public readonly code = 'INVALID_USER_STATUS_TRANSITION';
  constructor(currentStatus: string, targetStatus: string, reason?: string) {
    super(`Transição de status inválida de "${currentStatus}" para "${targetStatus}".${reason ? ` Motivo: ${reason}` : ''}`);
    this.name = 'InvalidUserStatusTransitionError';
  }
}

export class InvalidUserSubjectTypeError extends Error {
  public readonly code = 'INVALID_USER_SUBJECT_TYPE';
  constructor(subjectType: string) {
    super(`SubjectType de usuário inválido: "${subjectType}".`);
    this.name = 'InvalidUserSubjectTypeError';
  }
}

export class InvalidPublicIdError extends Error {
  public readonly code = 'INVALID_PUBLIC_ID';
  constructor(publicId: string, reason: string = 'Formato de PublicId inválido.') {
    super(`PublicId inválido "${publicId}": ${reason}`);
    this.name = 'InvalidPublicIdError';
  }
}

export class PublicIdAlreadyAssignedError extends Error {
  public readonly code = 'PUBLIC_ID_ALREADY_ASSIGNED';
  constructor(userId: number, currentPublicId: string) {
    super(`A conta ${userId} já possui um PublicId atribuído (${currentPublicId}) e não permite sobreposição.`);
    this.name = 'PublicIdAlreadyAssignedError';
  }
}

export class AlreadyDeletedError extends Error {
  public readonly code = 'ALREADY_DELETED';
  constructor(userId: number) {
    super(`A conta ${userId} já se encontra desativada/excluída.`);
    this.name = 'AlreadyDeletedError';
  }
}

export class InvalidEmailVerificationError extends Error {
  public readonly code = 'INVALID_EMAIL_VERIFICATION';
  constructor(message: string = 'Não é possível verificar um email inexistente na conta.') {
    super(message);
    this.name = 'InvalidEmailVerificationError';
  }
}

export class UserNotFoundError extends Error {
  public readonly code = 'USER_NOT_FOUND';
  constructor(identifier: string | number) {
    super(`Usuário "${identifier}" não encontrado.`);
    this.name = 'UserNotFoundError';
  }
}
