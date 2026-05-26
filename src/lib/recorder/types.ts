export type RecordedEventType = 'navigate' | 'click' | 'fill' | 'submit';

export interface RecordedEvent {
  type: RecordedEventType;
  url: string;
  timestamp: number;
  selector?: string;
  text?: string;
  value?: string;
}

export interface Recording {
  startUrl: string;
  recordedAt: string;
  events: RecordedEvent[];
}
