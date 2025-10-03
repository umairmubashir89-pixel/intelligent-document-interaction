import React from "react";

export default function ModelPicker(
  props: { models: string[]; value: string; busy?: boolean; onChange: (v: string) => void }
) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-zinc-400">Model:</span>
      <select
        className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm min-w-[280px] outline-none"
        value={props.value || ""}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">— Select a model —</option>
        {props.models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      {props.busy && <span className="text-sm text-zinc-500">starting…</span>}
    </div>
  );
}
