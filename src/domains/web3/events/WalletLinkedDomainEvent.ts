import { IDomainEvent } from '../../../shared/kernel/DomainEvent';

export interface WalletLinkedEventPayload {
  walletId: number;
  userId: number;
  address: string;
  networkId: number;
  verificationMethod: 'siwe' | 'signature';
  linkedAt: Date;
}

/**
 * Evento de Domínio: WalletLinkedDomainEvent
 * Disparado quando uma carteira externa é autenticada e vinculada com sucesso.
 */
export class WalletLinkedDomainEvent implements IDomainEvent {
  public readonly eventName = 'Web3.WalletLinked.v1';
  public readonly dateTimeOccurred: Date;

  constructor(
    public readonly payload: WalletLinkedEventPayload,
    dateTimeOccurred?: Date
  ) {
    this.dateTimeOccurred = dateTimeOccurred ?? new Date();
  }

  getAggregateId(): string {
    return String(this.payload.walletId);
  }
}
