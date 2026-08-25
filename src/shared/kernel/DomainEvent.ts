export interface IDomainEvent {
  dateTimeOccurred: Date;
  getAggregateId(): string;
}

export interface IDomainEventPublisher {
  publish(event: IDomainEvent): Promise<void>;
  publishAll(events: IDomainEvent[]): Promise<void>;
}
