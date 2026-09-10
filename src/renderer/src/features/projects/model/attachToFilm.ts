import { inferShotPurpose } from '../../video/model/autoAssemble';
import { clearLastProjectId, readLastProjectId, writeLastProjectId } from './handoff';
import { shotFromGeneration, type ProjectDoc } from './project';

export type AttachKind = 'video' | 'image';

export interface AttachToFilmInput {
  path: string;
  kind: AttachKind;
  prompt?: string;
  quality?: Parameters<typeof shotFromGeneration>[0]['quality'];
  status?: string;
}

export interface AttachToFilmResult {
  projectId: string;
  name: string;
}

function asDoc(raw: ProjectDoc): ProjectDoc {
  return {
    ...raw,
    shots: raw.shots ?? [],
    timeline: raw.timeline ?? null,
    productStillPath: raw.productStillPath ?? null,
  };
}

async function loadOrCreateFilm(): Promise<ProjectDoc> {
  if (!window.api?.loadProject || !window.api.saveProject) {
    throw new Error('Projects are unavailable');
  }
  const existingId = readLastProjectId();
  if (existingId) {
    const loaded = await window.api.loadProject(existingId) as ProjectDoc | null;
    if (loaded) return asDoc(loaded);
    clearLastProjectId(existingId);
  }
  const created = await window.api.createProject?.({
    name: 'Product video',
    preset: 'hero',
  });
  if (!created?.id) throw new Error('Could not create film');
  writeLastProjectId(created.id);
  return asDoc(created as ProjectDoc);
}

/** Put a generated clip or product still onto the current Film. No extra file copy. */
export async function attachGeneratedToFilm(input: AttachToFilmInput): Promise<AttachToFilmResult> {
  if (!input.path) throw new Error('Missing file');
  const doc = await loadOrCreateFilm();
  if (input.kind === 'image') {
    const next: ProjectDoc = {
      ...doc,
      productStillPath: doc.productStillPath || input.path,
    };
    await window.api.saveProject(next);
    writeLastProjectId(next.id);
    return { projectId: next.id, name: next.name };
  }
  if ((doc.shots ?? []).some((shot) => shot.artifactPath === input.path)) {
    writeLastProjectId(doc.id);
    return { projectId: doc.id, name: doc.name };
  }
  const shot = shotFromGeneration({
    path: input.path,
    prompt: input.prompt ?? '',
    purpose: inferShotPurpose(input.prompt ?? ''),
    quality: input.quality,
    status: input.status,
    projectId: doc.id,
  });
  const next: ProjectDoc = {
    ...doc,
    shots: [...(doc.shots ?? []), shot],
  };
  await window.api.saveProject(next);
  writeLastProjectId(next.id);
  return { projectId: next.id, name: next.name };
}
