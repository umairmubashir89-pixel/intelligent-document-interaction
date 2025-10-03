import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./index.css";

/** Show a readable crash instead of a blank screen */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; info?: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) { console.error("[UI] crashed", error, info); this.setState({ info }); }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ padding: 16, background: "#111", minHeight: "100vh", color: "#eee" }}>
          <h3 style={{ margin: "0 0 8px" }}>UI crashed</h3>
          <p style={{ margin: "0 0 10px", opacity: 0.8 }}>Open DevTools → Console for details.</p>
          <pre style={{ whiteSpace: "pre-wrap", border: "1px solid #333", borderRadius: 8, padding: 10, background: "#000" }}>
            {(error.stack || error.message || String(error))}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const el = document.getElementById("root");
if (!el) throw new Error("Missing #root element in index.html");

createRoot(el).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
