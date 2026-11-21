// The only parts of Sentry the app uses. Loaded on demand by monitoring.ts; named imports let
// the build leave out everything else (session replay, tracing, the feedback widget).
export { init, captureException } from '@sentry/react';
