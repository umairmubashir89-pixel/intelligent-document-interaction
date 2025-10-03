// apps/web/src/app/components/SettingsBar.tsx
import { useCallback } from "react";

export type ModelOptions = {
  temperature: number;
  top_p: number;
  repeat_penalty: number;
};

interface Props {
  value: ModelOptions;
  onChange: (next: ModelOptions) => void;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export default function SettingsBar({ value, onChange }: Props) {
  const set = useCallback(
    (patch: Partial<ModelOptions>) => onChange({ ...value, ...patch }),
    [value, onChange]
  );

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 md:grid-cols-3">
      <label className="flex items-center gap-2">
        <span className="opacity-70 min-w-[7rem]">temperature</span>
        <input
          type="range"
          step="0.05"
          min="0"
          max="2"
          value={value.temperature}
          onChange={(e) => set({ temperature: clamp(parseFloat(e.target.value || "0"), 0, 2) })}
          className="w-full"
        />
      </label>

      <label className="flex items-center gap-2">
        <span className="opacity-70 min-w-[7rem]">top_p</span>
        <input
          type="range"
          step="0.05"
          min="0"
          max="1"
          value={value.top_p}
          onChange={(e) => set({ top_p: clamp(parseFloat(e.target.value || "0"), 0, 1) })}
          className="w-full"
        />
      </label>

      <label className="flex items-center gap-2">
        <span className="opacity-70 min-w-[7rem]">repeat_penalty</span>
        <input
          type="range"
          step="0.05"
          min="0.5"
          max="2"
          value={value.repeat_penalty}
          onChange={(e) => set({ repeat_penalty: clamp(parseFloat(e.target.value || "1"), 0.5, 2) })}
          className="w-full"
        />
      </label>
      <input aria-label="repeat_penalty value" type="number" step="0.05" min="0.5" max="2" value={value.repeat_penalty} onChange={(e)=> set({ repeat_penalty: clamp(parseFloat(e.target.value || "1"),0.5,2) })} className="w-20 rounded-md border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-700" />
    </div>
  );
}
