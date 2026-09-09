const FROM_RE = /^\/(video|create|threed|assets|projects)(\/[\w-]+)?$/;

export function safeStudioFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!FROM_RE.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function studioHref(family: string, from?: string | null): string {
  const query = new URLSearchParams();
  if (family && family !== 'image') query.set('family', family);
  if (from) query.set('from', from);
  const qs = query.toString();
  return qs ? `/studio?${qs}` : '/studio';
}

export function studioReturnLabelKey(from: string): string {
  if (from.startsWith('/video')) return 'studio.back_to_voiceover';
  if (from.startsWith('/threed')) return 'studio.back_to_threed';
  if (from.startsWith('/create')) return 'studio.back_to_create';
  if (from.startsWith('/assets')) return 'studio.back_to_assets';
  if (from.startsWith('/projects')) return 'studio.back_to_projects';
  return 'studio.back_to_work';
}
