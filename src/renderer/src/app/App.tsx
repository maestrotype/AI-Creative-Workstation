import type { ReactElement } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import { Shell } from './layouts/Shell/Shell';
import { HomePage } from '../features/home';
import { CreatePage } from '../features/create/ui/CreatePage';
import { ProjectsPage } from '../features/projects/ui/ProjectsPage';
import { AssetsPage } from '../features/assets/ui/AssetsPage';
import { StudioPage } from '../features/studio/ui/StudioPage';
import { SettingsPage } from '../features/settings/ui/SettingsPage';
import { VideoPage } from '../features/video/ui/VideoPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/create', element: <CreatePage /> },
      { path: '/video', element: <VideoPage /> },
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/assets', element: <AssetsPage /> },
      { path: '/studio', element: <StudioPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);

/**
 * Application root.
 *
 * Configures the router and application-wide providers.
 */
export function App(): ReactElement {
  return <RouterProvider router={router} />;
}
