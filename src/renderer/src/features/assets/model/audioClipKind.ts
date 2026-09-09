export type AudioClipKind = 'mic' | 'system' | 'imported' | 'generated' | 'voiceover';

export const AUDIO_KIND_ORDER: readonly AudioClipKind[] = [
  'mic',
  'system',
  'imported',
  'generated',
  'voiceover',
];

export function audioClipKind(name: string): AudioClipKind {
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
  if (stem.startsWith('mic-') || stem.startsWith('mic_')) return 'mic';
  if (stem.startsWith('system-') || stem.startsWith('capture-')) return 'system';
  if (stem.startsWith('tts-') || stem.startsWith('tts_')) return 'generated';
  if (
    stem.startsWith('vo-')
    || stem.startsWith('fit-')
    || stem.startsWith('voiceover-')
  ) {
    return 'voiceover';
  }
  return 'imported';
}

/** Compact label for column cards: timestamps become a readable date. */
export function audioClipLabel(name: string, locale?: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const stamped = stem.match(/^(?:mic|system|capture|tts|vo|fit|voiceover|import)[-_](\d{10,13})/i);
  if (stamped) {
    const raw = Number(stamped[1]);
    const ms = stamped[1].length <= 10 ? raw * 1000 : raw;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      const stamp = date.toLocaleString(locale, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      return ext ? `${stamp} · ${ext}` : stamp;
    }
  }
  return name;
}
