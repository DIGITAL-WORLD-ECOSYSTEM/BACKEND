import { IDomainEvent } from '../../../shared/kernel/DomainEvent';

export interface WalletCreatedEventPayload {
  walletId: number;
  userId: number;
  address: string;
  networkId: number;
  provenance: 'internal' | 'external';
  isPrimary: boolean;
}

/**
 * Evento de Domínio: WalletCreatedDomainEvent
 * Disparado quando uma carteira é criada ou associada com sucesso.
 * Permite que outros bounded contexts (ex: finance para contas de custódia) reajam.
 */
export class WalletCreatedDomainEvent implements IDomainEvent {
  public readonly eventName = 'Web3.WalletCreated.v1';
  public readonly dateTimeOccurred: Date;

  constructor(
    public readonly payload: WalletCreatedEventPayload,
    dateTimeOccurred?: Date
  ) {
    this.dateTimeOccurred = dateTimeOccurred ?? new Date();
  }

  getAggregateId(): string {
    return String(this.payload.walletId);
  }
}
