import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import type { NavId } from '../../../core/types';
import { NAVIGATION_ITEMS, isValidNavId } from '../../../features/home/model/navigation';
import { SideNavigation } from '../../../features/home/ui/SideNavigation/SideNavigation';
import styles from './Shell.module.css';

type EngineStatus = 'stopped' | 'starting' | 'ready' | 'error';

export function Shell(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('stopped');

  const pathNavId = location.pathname.split('/')[1] || 'home';
  const activeId: NavId = isValidNavId(pathNavId) ? pathNavId : 'home';

  const handleSelect = (id: NavId) => {
    if (id === 'home') navigate('/');
    else navigate(`/${id}`);
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
      />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
