import React, { useRef, useState } from "react";

export default function Composer(props: { onSend: (text: string, queryHint?: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [rec, setRec]   = useState(false);
  const [uploading, setUploading] = useState<number>(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSend() {
    if (!text.trim()) return;
    const toSend = text.trim();
    setText("");
    props.onSend(toSend, toSend);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(1);
    try {
      await uploadRagFile(f, (p) => setUploading(Math.max(1, Math.round(p))));
    } catch (e: any) {
      alert(e?.message || e);
    }
    setUploading(0);
  }

  return (
    <div className="border-t border-zinc-800 px-4 py-4">
      <div className="max-w-4xl mx-auto flex items-end gap-2">
        {/* paperclip (left) */}
        <button
          onClick={() => fileRef.current?.click()}
          className="shrink-0 h-10 w-10 rounded-full bg-zinc-800 hover:bg-zinc-700 grid place-items-center"
          title="Upload file for RAG"
        >
          📎
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />

        {/* text area */}
        <textarea
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-2xl resize-none outline-none px-4 py-3 text-[15px] leading-6 max-h-48"
          placeholder="Ask anything"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          disabled={props.disabled}
        />

        {/* send */}
        <button
          onClick={handleSend}
          className="shrink-0 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500"
          disabled={props.disabled}
        >Send</button>
      </div>

      {/* Upload progress & chunking indicator */}
      {uploading > 0 && (
        <div className="max-w-4xl mx-auto pt-2 text-sm text-zinc-400 flex items-center gap-3">
          <div className="h-2 flex-1 bg-zinc-800 rounded">
            <div className="h-2 bg-blue-500 rounded" style={{ width: `${uploading}%` }} />
          </div>
          <span>{uploading < 100 ? `Uploading… ${uploading}%` : "Chunking… building vectors"}</span>
        </div>
      )}
    </div>
  );
}
