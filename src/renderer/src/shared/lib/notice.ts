export type NoticeTone = 'error' | 'info';

export interface AppNotice {
  message: string;
  tone: NoticeTone;
}

let openMessage = '';

/** One window at a time. The same text does not open again while it is up. */
export function pushNotice(message: string, tone: NoticeTone = 'error'): void {
  const text = message.trim();
  if (!text || text === openMessage) return;
  openMessage = text;
  window.dispatchEvent(new CustomEvent<AppNotice>('acw-notice', {
    detail: { message: text, tone },
  }));
}

export function dismissNotice(message: string): void {
  if (openMessage === message.trim()) openMessage = '';
}
