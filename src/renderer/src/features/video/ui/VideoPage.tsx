import type { ReactNode } from 'react';

import { FromIdeaPanel } from './FromIdeaPanel';
import { FromRecordingPanel } from './FromRecordingPanel';
import { DirectorProvider, useDirector } from './DirectorBoard';
import {
  DirectorResultPane,
  DirectorSourcesPane,
  DirectorTimelinePane,
} from './DirectorPanes';
import { VideoDock, VideoMenuBar, useDockLayout } from './VideoDock';
import styles from './VideoPage.module.css';

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

export function VideoPage(): ReactNode {
  const [dock, setDock] = useDockLayout();

  return (
    <div className={styles.container} data-mode="studio">
      <VideoMenuBar state={dock} onState={setDock} />
      <DirectorProvider>
        <VideoDock
          state={dock}
          onState={setDock}
          panels={{
            timeline: <DirectorTimelinePane />,
            preview: <DirectorResultPane />,
            sources: <DirectorSourcesPane />,
            storyboard: <StoryboardPane />,
            recording: <RecordingPane />,
          }}
        />
      </DirectorProvider>
    </div>
  );
}
