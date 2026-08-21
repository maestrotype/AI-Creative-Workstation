import type { ReactElement } from 'react';

import { HomePage } from '../features/home';

/**
 * Application root.
 *
 * Routing is not wired in this milestone —
 * Home (Start Page) is the only view.
 */
export function App(): ReactElement {
  return <HomePage />;
}
