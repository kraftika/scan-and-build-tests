export type RecordedEventType = 'navigate' | 'click' | 'fill' | 'select' | 'submit' | 'hover' | 'popover';

export interface RecordedEvent {
  type: RecordedEventType;
  url: string;
  timestamp: number;
  selector?: string;
  text?: string;
  value?: string;
  domSnapshot?: string; // ARIA tree captured on navigate events
}

export interface Recording {
  startUrl: string;
  recordedAt: string;
  events: RecordedEvent[];
}
