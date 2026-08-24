import type { ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import type { NavId } from '../../../core/types';
import { NAVIGATION_ITEMS, isValidNavId } from '../../../features/home/model/navigation';
import { SideNavigation } from '../../../features/home/ui/SideNavigation/SideNavigation';
import styles from './Shell.module.css';

export function Shell(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();

  // Derive active NavId from the current pathname
  const pathNavId = location.pathname.split('/')[1] || 'home';
  const activeId: NavId = isValidNavId(pathNavId) ? pathNavId : 'home';

  const handleSelect = (id: NavId) => {
    if (id === 'home') navigate('/');
    else navigate(`/${id}`);
  };

  return (
    <div className={styles.shell}>
      <SideNavigation
        items={NAVIGATION_ITEMS}
        activeId={activeId}
        onSelect={handleSelect}
      />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
