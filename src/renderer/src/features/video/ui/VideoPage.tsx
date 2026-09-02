import type { ReactNode } from 'react';

import { DirectorProvider, useDirector } from './DirectorBoard';
import {
  DirectorResultPane,
  DirectorSourcesPane,
  DirectorTimelinePane,
} from './DirectorPanes';
import { FromIdeaPanel } from './FromIdeaPanel';
import { FromRecordingPanel } from './FromRecordingPanel';
import { VideoDock, VideoMenuBar, useDockLayout } from './VideoDock';
import { VideoPipelineShell } from './VideoPipelineShell';
import type { DockState } from '../model/videoDockLayout';
import styles from './VideoPage.module.css';

function maxZ(state: DockState): number {
  return Math.max(...Object.values(state.panels).map((p) => p.z), 1);
}

function StoryboardPane(): ReactNode {
  const d = useDirector();
  return (
    <div className={styles.densePane}>
      <FromIdeaPanel
        embedded
        onSendToTimeline={(items) => {
          d.addSources(
            items.map((it) => ({ kind: 'image' as const, path: it.path, name: it.name, durationSec: it.durationSec })),
            true,
          );
        }}
      />
    </div>
  );
}

function RecordingPane(): ReactNode {
  const d = useDirector();
  return (
    <div className={styles.densePane}>
      <FromRecordingPanel
        embedded
        onProduced={(path) => { d.addSources([{ kind: 'video', path }], true); }}
      />
    </div>
  );
}

function VideoStudioShell(): ReactNode {
  const [dock, setDock] = useDockLayout();
  const d = useDirector();

  const openVoiceover = () => {
    d.openVoiceover();
    // Voiceover lives in the pipeline mode: one centered stage, no panel hunting.
    setDock({
      ...dock,
      mode: 'pipeline',
      panels: {
        ...dock.panels,
        sources: {
          ...dock.panels.sources,
          visible: true,
          z: maxZ(dock) + 1,
        },
      },
    });
  };

  return (
    <>
      <VideoMenuBar state={dock} onState={setDock} onOpenVoiceover={openVoiceover} />
      <div className={styles.studioBody}>
        {dock.mode === 'pipeline' ? (
          <VideoPipelineShell />
        ) : (
          <VideoDock
            state={dock}
            onState={setDock}
            panels={{
              timeline: <DirectorTimelinePane />,
              preview: <DirectorResultPane />,
              sources: <DirectorSourcesPane onOpenVoiceover={openVoiceover} />,
              storyboard: <StoryboardPane />,
              recording: <RecordingPane />,
            }}
          />
        )}
      </div>
    </>
  );
}

export function VideoPage(): ReactNode {
  return (
    <div className={styles.container} data-mode="studio">
      <DirectorProvider>
        <VideoStudioShell />
      </DirectorProvider>
    </div>
  );
}
