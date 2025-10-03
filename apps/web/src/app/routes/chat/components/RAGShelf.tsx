import React, { useRef, useState } from "react";

export default function RAGShelf() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");

  async function onChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setStatus("Uploading & indexing…");
      const fd = new FormData();
      fd.append("file", f);           // server accepts any name, 'file' is fine

      const res = await fetch("/rag/upload", { method: "POST", body: fd });
      const j = await res.json();

      if (!res.ok || !j?.ok) throw new Error(j?.error || res.statusText);

      (window as any).__argon_fileId = j.fileId; // Composer will include this in /chat
      setFileName(j.fileName);
      setStatus(`Indexed ${j.chunks} chunks`);
    } catch (err: any) {
      alert("RAG upload failed: " + (err?.message || err));
      setFileName("");
      setStatus("");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" onChange={onChoose} />
      {fileName && <span className="text-xs text-white/70">{fileName}</span>}
      {status && <span className="text-xs text-white/50">{status}</span>}
    </div>
  );
}
