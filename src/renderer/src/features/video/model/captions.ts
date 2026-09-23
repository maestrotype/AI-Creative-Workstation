import type { TimelineClip } from './directorTimeline';
import type { VoiceoverScript } from './voiceoverScript';

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function captionClipsFromScript(script: VoiceoverScript, offsetSec = 0): TimelineClip[] {
  return script.segments
    .filter((segment) => segment.text.trim() && segment.end_sec > segment.start_sec)
    .map((segment, index) => ({
      id: `caption-${Date.now().toString(36)}-${index}`,
      binId: null,
      track: 't1',
      startSec: Math.max(0, segment.start_sec + offsetSec),
      durationSec: Math.max(0.4, segment.end_sec - segment.start_sec),
      sourceInSec: 0,
      label: `Caption ${index + 1}`,
      text: segment.text.trim(),
      autoLength: false,
    }));
}

export function scriptToSrt(script: VoiceoverScript, offsetSec = 0): string {
  return script.segments
    .filter((segment) => segment.text.trim() && segment.end_sec > segment.start_sec)
    .map((segment, index) => [
      String(index + 1),
      `${srtTime(segment.start_sec + offsetSec)} --> ${srtTime(segment.end_sec + offsetSec)}`,
      segment.text.trim(),
      '',
    ].join('\n'))
    .join('\n');
}
