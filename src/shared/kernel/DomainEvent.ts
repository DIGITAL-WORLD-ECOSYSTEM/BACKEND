export interface IDomainEvent {
  readonly eventName?: string;
  dateTimeOccurred: Date;
  getAggregateId(): string;
}

export class LedgerTransactionPostedEvent implements IDomainEvent {
  readonly eventName = 'LedgerTransactionPosted.v1';

  constructor(
    public readonly transactionId: number,
    public readonly idempotencyKey: string,
    public readonly requestHash: string,
    public readonly dateTimeOccurred: Date = new Date()
  ) {}

  getAggregateId(): string {
    return String(this.transactionId);
  }
}

export interface IDomainEventPublisher {
  publish(event: IDomainEvent): Promise<void>;
  publishAll(events: IDomainEvent[]): Promise<void>;
}

