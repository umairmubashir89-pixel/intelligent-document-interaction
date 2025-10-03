// Provides a safe global refreshFiles() so any legacy calls won't crash the UI.
// Minimal, robust behavior: reload the page, which re-queries files via your existing app flow.

declare global {
  interface Window {
    refreshFiles?: () => Promise<void> | void;
  }
}

// If some other part already defined it, don't overwrite.
if (typeof window !== "undefined" && typeof window.refreshFiles !== "function") {
  window.refreshFiles = async () => {
    try {
      // If you later want SPA-style refresh, you can replace this with
      // a custom event your App.tsx listens to. For now, keep it robust:
      location.reload();
    } catch {
      // Absolute fallback
      location.reload();
    }
  };
}

export {};
