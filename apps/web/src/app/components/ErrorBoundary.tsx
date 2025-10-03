// apps/web/src/app/components/ErrorBoundary.tsx
import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string; stack?: string };

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(err: unknown): State {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return { hasError: true, message, stack };
  }

  componentDidCatch(err: unknown, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 rounded-xl border border-red-400 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">
          <div className="mb-2 text-base font-semibold">UI crashed while rendering.</div>
          <div className="whitespace-pre-wrap">
            {this.state.message || "Unknown error"}
            {this.state.stack ? `\n\n${this.state.stack}` : ""}
          </div>
          <div className="mt-2 opacity-70">
            Check the console (F12 → Console) for more details.
          </div>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}
