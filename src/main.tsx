import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startMonitoring } from './lib/monitoring';
import { notePendingShare, registerShareWorker } from './lib/incomingShare';

// A recipe shared into the installed app: note it before anything else (it has to survive a
// trip to the log-in page), and keep the worker that receives shares registered.
notePendingShare();
registerShareWorker();

// Broken images (a missing recipe or ingredient photo) get a quiet placeholder instead
// of the browser's broken-image icon.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = 'true';
  img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%236f665c' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21'/%3E%3C/svg%3E";
  img.classList.add('broken-image-fallback');
}, true);

// After a new version is deployed, a screen file from the old one may be gone: load the new
// version once instead of showing a broken screen (at most once a minute, so it can't loop).
window.addEventListener('vite:preloadError', event => {
  let last = 0;
  try { last = Number(sessionStorage.getItem('forka_reloaded_for_update') ?? 0); } catch { /* reload anyway */ }
  if (Date.now() - last < 60_000) return;
  try { sessionStorage.setItem('forka_reloaded_for_update', String(Date.now())); } catch { /* fine */ }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Error reports (Sentry), when VITE_SENTRY_DSN is set; loaded once the page is idle.
startMonitoring();
