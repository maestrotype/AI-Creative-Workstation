import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import type { NavId } from '../../../core/types';
import { NAVIGATION_ITEMS, isValidNavId } from '../../../features/home/model/navigation';
import { SideNavigation } from '../../../features/home/ui/SideNavigation/SideNavigation';
import { readLastProjectId } from '../../../features/projects/model/handoff';
import { cx } from '../../../shared/lib/cx';
import { EngineMonitor } from './EngineMonitor';
import styles from './Shell.module.css';

type EngineStatus = 'stopped' | 'starting' | 'ready' | 'error';

export function Shell(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('stopped');
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);

  const pathNavId = location.pathname.split('/')[1] || 'home';
  const activeId: NavId = isValidNavId(pathNavId) ? pathNavId : 'home';
  const workspaceLayout = activeId === 'video';

  // Resolve active project ID from current URL context
  const activeProjectId =
    new URLSearchParams(location.search).get('project') ||
    (location.pathname.startsWith('/projects/') ? location.pathname.split('/')[2] : null) ||
    null;

  // Load active project name when project context changes
  useEffect(() => {
    if (!activeProjectId) {
      setActiveProjectName(null);
      return;
    }
    // Try to load project name from IPC
    window.api?.loadProject?.(activeProjectId)
      .then((doc) => {
        if (doc?.name) setActiveProjectName(doc.name);
      })
      .catch(() => setActiveProjectName(null));
  }, [activeProjectId]);

  const handleSelect = (id: NavId) => {
    if (id === 'home') {
      navigate('/');
      return;
    }
    if (id === 'projects') {
      navigate('/projects');
      return;
    }
    /* When the user clicks "Video" (Director) in the sidebar, preserve
       the current film context so the Director opens the correct Film
       instead of falling back to a stale standalone localStorage session. */
    if (id === 'video') {
      const currentProjectId =
        new URLSearchParams(location.search).get('project')
        || (location.pathname.startsWith('/projects/') ? location.pathname.split('/')[2] : null)
        || readLastProjectId();
      if (currentProjectId) {
        navigate(`/video?project=${encodeURIComponent(currentProjectId)}`);
        return;
      }
    }
    navigate(`/${id}`);
  };

  useEffect(() => {
    let cancelled = false;
    const apply = (status: string) => {
      if (cancelled) return;
      if (status === 'ready' || status === 'starting' || status === 'error' || status === 'stopped') {
        setEngineStatus(status);
      }
    };
    const pull = () => {
      window.api?.getEngineStatus().then((s) => apply(s.status)).catch(() => apply('stopped'));
    };
    pull();
    const timer = window.setInterval(pull, 4000);
    const unsub = window.api?.onEngineStatus((data) => apply(data.status)) ?? (() => {});
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsub();
    };
  }, []);

  return (
    <div className={styles.shell}>
      <SideNavigation
        items={NAVIGATION_ITEMS}
        activeId={activeId}
        onSelect={handleSelect}
        engineStatus={engineStatus}
        activeProjectName={activeProjectName}
      />
      <main className={cx(styles.main, workspaceLayout && styles.mainWorkspace)}>
        <EngineMonitor />
        <Outlet />
      </main>
    </div>
  );
}
