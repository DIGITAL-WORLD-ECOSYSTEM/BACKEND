export class LedgerImbalanceError extends Error {
  constructor(message: string = 'A transação não está balanceada. A soma dos débitos deve ser exatamente igual à soma dos créditos.') {
    super(message);
    this.name = 'LedgerImbalanceError';
    Object.setPrototypeOf(this, LedgerImbalanceError.prototype);
  }
}
