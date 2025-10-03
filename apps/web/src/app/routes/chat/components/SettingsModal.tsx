import { useEffect, useRef, useState } from "react";
import type { ModelOptions } from "../../components/SettingsBar";

type ThemeKind = "light" | "dark" | "system";

type Props = {
  onClose: () => void;
  theme: ThemeKind;
  onChangeTheme: (t: ThemeKind) => void;
  options: ModelOptions;
  onChangeOptions: (o: ModelOptions) => void;
  user: { name: string; email: string };
  onChangeUser: (u: { name: string; email: string }) => void;
  chats: any[];
  onExport: () => void;
  onDeleteAll: () => void;
};

function Card({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-28 w-56 flex-col items-center justify-center rounded-2xl border text-sm transition
      ${active ? "border-blue-500 ring-2 ring-blue-500/30" : "border-[var(--border)] hover:border-blue-400/70"}`}
      style={{ background: "color-mix(in oklab, var(--panel) 96%, transparent)", color: "var(--fg)" }}
    >
      <div className="mb-2 text-xl">{icon}</div>
      <div className="font-medium">{label}</div>
    </button>
  );
}

export default function SettingsModal(props: Props) {
  const { theme, onChangeTheme, onClose, user, onChangeUser, options, onChangeOptions, onExport, onDeleteAll } = props;

  // a tiny focus trap
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // focus first focusable
    setTimeout(() => {
      const target = el?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
      target?.focus();
    }, 0);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [tab, setTab] = useState<"general" | "profile" | "data" | "about">("general");

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div
        ref={wrapRef}
        className="grid max-h-[90vh] w-[min(980px,95vw)] grid-cols-[220px,1fr] gap-4 overflow-hidden rounded-3xl p-4"
        style={{ background: "var(--panel)", color: "var(--fg)" }}
      >
        {/* left nav */}
        <div className="space-y-2">
          {[
            ["general", "General"],
            ["profile", "Profile"],
            ["data", "Data"],
            ["about", "About"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id as any)}
              className={`w-full rounded-2xl px-3 py-2 text-left ${tab === id ? "bg-[color:color-mix(in_olab,var(--panel)_90%,white)] font-medium" : "hover:bg-[color:color-mix(in_olab,var(--panel)_92%,white)]"}`}
              style={{ border: "1px solid var(--border)" }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* content */}
        <div className="overflow-auto rounded-2xl" style={{ border: "1px solid var(--border)", background: "color-mix(in oklab, var(--panel) 96%, transparent)" }}>
          {tab === "general" && (
            <div className="space-y-8 p-6">
              <div>
                <div className="mb-3 text-lg font-semibold">Theme</div>
                <div className="flex flex-wrap gap-4">
                  <Card active={theme === "light"} icon={"☀️"} label="Light" onClick={() => onChangeTheme("light")} />
                  <Card active={theme === "dark"} icon={"🌙"} label="Dark" onClick={() => onChangeTheme("dark")} />
                  <Card active={theme === "system"} icon={"💻"} label="System" onClick={() => onChangeTheme("system")} />
                </div>
              </div>

              <div>
                <div className="mb-2 text-lg font-semibold">Generation</div>
                <div className="grid max-w-lg grid-cols-2 gap-3">
                  <label className="text-sm opacity-80">
                    Temperature
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={2}
                      value={options.temperature}
                      onChange={(e) => onChangeOptions({ ...options, temperature: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border px-2 py-1"
                      style={{ background: "white", color: "#111", borderColor: "#D1D5DB" }}
                    />
                  </label>
                  <label className="text-sm opacity-80">
                    top_p
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      value={options.top_p}
                      onChange={(e) => onChangeOptions({ ...options, top_p: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border px-2 py-1"
                      style={{ background: "white", color: "#111", borderColor: "#D1D5DB" }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {tab === "profile" && (
            <div className="space-y-4 p-6">
              <div className="text-lg font-semibold">Profile</div>
              <label className="block text-sm">
                Name
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  style={{ background: "white", color: "#111", borderColor: "#D1D5DB" }}
                  value={user.name}
                  onChange={(e) => onChangeUser({ ...user, name: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                Email
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  style={{ background: "white", color: "#111", borderColor: "#D1D5DB" }}
                  value={user.email}
                  onChange={(e) => onChangeUser({ ...user, email: e.target.value })}
                />
              </label>
            </div>
          )}

          {tab === "data" && (
            <div className="space-y-4 p-6">
              <div className="text-lg font-semibold">Data</div>
              <div className="flex gap-3">
                <button onClick={onExport} className="rounded-xl bg-blue-600 px-3 py-2 text-white hover:bg-blue-500">
                  Export all chats
                </button>
                <button onClick={props.onDeleteAll} className="rounded-xl bg-red-600 px-3 py-2 text-white hover:bg-red-500">
                  Delete all chats
                </button>
              </div>
            </div>
          )}

          {tab === "about" && (
            <div className="space-y-2 p-6">
              <div className="text-lg font-semibold">About</div>
              <p className="opacity-80">Argon — local web UI for Ollama models.</p>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="absolute right-5 top-4 rounded-full px-2 py-1 text-xl leading-none hover:bg-black/10"
          aria-label="Close"
          title="Close"
          style={{ color: "var(--fg)" }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
