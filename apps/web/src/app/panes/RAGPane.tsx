import React, { useEffect, useState } from "react";
import ModelPicker from "../components/ModelPicker";

const RAGPane: React.FC = () => {
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<any[]>([]);
  const [answer, setAnswer] = useState("");
  const [model, setModel] = useState("");

  async function refreshFiles() {
    try {
      const res = await fetch("/rag/files");
      const data = await res.json();
      setFiles(Array.isArray(data) ? data : Array.isArray((data as any)?.files) ? (data as any).files : []);
    } catch { setFiles([]); }
  }
  useEffect(() => { refreshFiles(); }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const form = new FormData();
    form.append("file", f, f.name);
    await fetch("/rag/upload", { method: "POST", body: form });
    await refreshFiles();
    e.currentTarget.value = "";
  }

  async function doSearch() {
    setHits([]);
    const res = await fetch("/rag/search", { method: "POST", headers: { "Content-Type": "application/json"}, body: JSON.stringify({ query }) });
    const data = await res.json();
    setHits(Array.isArray(data) ? data : Array.isArray((data as any)?.results) ? (data as any).results : []);
  }

  async function doAnswer() {
    setAnswer("");
    const res = await fetch("/rag/answer", { method: "POST", headers: { "Content-Type": "application/json"}, body: JSON.stringify({ query, model }) });
    const reader = res.body?.getReader();
    if (!reader) { setAnswer(await res.text()); return; }
    const dec = new TextDecoder(); let acc = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setAnswer(acc); }
  }

  return (
    <div className="grid gap-3">
      <div>
        <label className="block text-sm mb-1">Add a document (pdf/txt/md)</label>
        <input type="file" onChange={upload} />
      </div>
      <div>
        <label className="block text-sm mb-1">Indexed files</label>
        <div className="border rounded p-2 min-h-10 text-sm">
          {files.length === 0 ? <span className="opacity-60">None</span> :
            <ul className="list-disc ml-5">{files.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Query</label>
          <input className="border rounded px-2 py-1 w-full" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ask about your files..." />
        </div>
        <ModelPicker value={model} onChange={setModel} />
      </div>
      <div className="flex gap-2">
        <button className="border rounded px-3 py-1" onClick={doSearch} disabled={!query.trim()}>Search</button>
        <button className="border rounded px-3 py-1" onClick={doAnswer} disabled={!query.trim() || !model}>Answer with context</button>
      </div>
      <div>
        <div className="text-sm font-semibold mb-1">Search hits</div>
        <div className="border rounded p-2 min-h-10 text-sm whitespace-pre-wrap">
          {hits.length === 0 ? <span className="opacity-60">No hits</span> :
            hits.map((h, i) => <div key={i} className="mb-2">{JSON.stringify(h, null, 2)}</div>)
          }
        </div>
      </div>
      <div>
        <div className="text-sm font-semibold mb-1">Answer</div>
        <div className="border rounded p-2 min-h-10 whitespace-pre-wrap">{answer || <span className="opacity-60">—</span>}</div>
      </div>
    </div>
  );
};
export default RAGPane;
