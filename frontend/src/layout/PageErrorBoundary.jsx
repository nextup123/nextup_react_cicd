// A page that throws shows a notice instead of a blank screen; the sidebar,
// top bar and safety buttons keep working, so the user can always move on.
import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "../components/ui";
import { isChunkLoadError, reloadPage } from "../lib/pageReload";
import { PageLoadFallback } from "./PageLoadGuard";

export class PageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[page]", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    // the page's code could not be fetched even after retries (the console was updated on the
    // robot, or the server was restarting): the browser remembers that failure until the
    // document is reloaded, so the web app reloads itself at once (as soon as the server answers)
    if (isChunkLoadError(error)) return <PageLoadFallback title="Loading this page again…" countdown={0} />;
    return (
      <div className="page-error">
        <AlertTriangle size={28} />
        <h2>This page ran into a problem</h2>
        <p className="muted small">The rest of the console still works. You can reload this page or open another one from the menu.</p>
        <pre className="mono xs">{String(error?.message || error)}</pre>
        <Button icon={RotateCcw} onClick={() => { this.setState({ error: null }); reloadPage(); }} title="Load this page again (Alt+R)">Reload page</Button>
      </div>
    );
  }
}

/** For small widgets (top bar, banners): a failing one disappears instead of taking the app down. */
export function Safe({ children }) {
  return <PageErrorBoundary fallback={null}>{children}</PageErrorBoundary>;
}

/**
 * Around the whole app: a failure outside any page (sidebar, top bar) shows a notice with
 * "Reload page" / "Reload web app" and the app reloads itself, instead of a blank window.
 */
export class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[app]", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-error">
        <PageLoadFallback title="The console ran into a problem" />
      </div>
    );
  }
}
