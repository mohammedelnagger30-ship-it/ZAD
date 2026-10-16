import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

// Nothing renders above this boundary. Every ErrorBoundary in the app sits
// inside AppContent, so a crash in AuthScreen, in the gate, or in the shell
// before those mount used to leave a white page with no way out but the
// browser's own reload — the one thing a phone webview does not offer. This
// boundary is what makes the reload button exist for those cases too.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
