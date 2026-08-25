import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* Bundled fonts — local-first, no network dependency at runtime. */
import '@fontsource/sora/300.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';

/* Design tokens must load before global styles and any component module. */
import './shared/styles/tokens.css';
import './shared/styles/global.css';

import './core/i18n'; // Initialize i18n before rendering App
import { App } from './app/App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element "#root" is missing in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
