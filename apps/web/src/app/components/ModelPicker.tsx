import React, { useEffect, useState } from "react";

/**
 * Global ModelPicker used by the Chat page (and possibly others).
 * Behavior:
 *  - Optimistically updates the parent model state (onChange) immediately.
 *  - Immediately asks the server to stop previous, pull (if needed), and warm the new model (keep_alive),
 *    so `ollama ps` shows it right away – no need to send a prompt.
 *  - Reverts UI selection if the warm fails.
 */
export default function ModelPicker({
  model = "",
  onChange,
}: {
  model?: string;
  onChange: (m: string) => void;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>(model || "");
  const [warming, setWarming] = useState(false);

  useEffect(() => setCurrent(model || ""), [model]);

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r = await fetch("/models", { method: "GET" });
        const j = await r.json();
        const arr = Array.isArray(j?.models) ? (j.models as string[]) : Array.isArray(j) ? (j as string[]) : [];
        if (!gone) setItems(arr);
      } catch {
        if (!gone) setItems([]);
      }
    })();
    return () => { gone = true; };
  }, []);

  async function select(next: string) {
    const prev = current;

    // Update UI immediately so the rest of the app knows which model to use
    onChange(next);
    setCurrent(next);

    if (!next) return;

    // Warm on the server NOW: stop prev (if any), pull if needed, warm with keep_alive
    try {
      setWarming(true);
      const r = await fetch("/models/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: next, prev, keepAlive: "30m" }),
      });
      if (!r.ok) {
        let msg = `Failed to start "${next}" (${r.status})`;
        try { const j = await r.json(); if (j?.error) msg = String(j.error); } catch {}
        // Revert if warm failed
        onChange(prev);
        setCurrent(prev);
        alert(msg);
      }
    } finally {
      setWarming(false);
    }
  }

  return (
    <div className="relative inline-block">
      <select
        className="w-full rounded-lg border px-3 py-2 text-sm"
        value={current}
        onChange={(e) => select(e.target.value)}
        disabled={warming}
        aria-label="Select model"
      >
        <option value="">— Select a model —</option>
        {items.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      {warming && (
        <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 text-xs opacity-70">starting…</span>
      )}
    </div>
  );
}
