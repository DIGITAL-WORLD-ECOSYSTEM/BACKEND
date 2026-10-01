import { IDomainEvent } from '../../../shared/kernel/DomainEvent';

export interface WalletUnlinkedEventPayload {
  userId: number;
  address: string;
  unlinkedAt: Date;
}

/**
 * Evento de Domínio: WalletUnlinkedDomainEvent
 * Disparado quando uma carteira é revogada ou desvinculada pelo usuário.
 */
export class WalletUnlinkedDomainEvent implements IDomainEvent {
  public readonly eventName = 'Web3.WalletUnlinked.v1';
  public readonly dateTimeOccurred: Date;

  constructor(
    public readonly payload: WalletUnlinkedEventPayload,
    dateTimeOccurred?: Date
  ) {
    this.dateTimeOccurred = dateTimeOccurred ?? new Date();
  }

  getAggregateId(): string {
    return `${this.payload.userId}:${this.payload.address}`;
  }
}
