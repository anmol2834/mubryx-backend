import * as crypto from 'crypto';

export class RealtimeEventDto<T = any> {
  eventId: string;
  event: string;
  timestamp: string;
  data: T;

  constructor(event: string, data: T, eventId?: string) {
    this.eventId = eventId || crypto.randomUUID();
    this.event = event;
    this.timestamp = new Date().toISOString();
    this.data = data;
  }

  static create<T>(event: string, data: T, eventId?: string): RealtimeEventDto<T> {
    return new RealtimeEventDto<T>(event, data, eventId);
  }
}
