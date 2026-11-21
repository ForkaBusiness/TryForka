import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { reportError } from '../lib/monitoring';
import { Button, PageContainer } from './ds';

// If a screen crashes while drawing, the family sees a calm way back instead of a blank page,
// and the error is reported (when monitoring is on).

interface Props { children: ReactNode }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack ?? '' });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="min-h-dvh bg-cream">
        <PageContainer title="Something went wrong">
          <p className="text-body text-ink-muted">This screen couldn't load. Reload Forka to keep going. Everything you've saved is safe.</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            <RotateCw size={20} strokeWidth={1.75} aria-hidden />
            Reload Forka
          </Button>
        </PageContainer>
      </main>
    );
  }
}
