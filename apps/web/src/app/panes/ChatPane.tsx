import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import ModelPicker from "../components/ModelPicker";

async function* ndjsonStream(res: Response) {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try { yield JSON.parse(s); } catch { yield s; }
    }
  }
  if (buf.trim()) { try { yield JSON.parse(buf.trim()); } catch { yield buf.trim(); } }
}

type Role = "system" | "user" | "assistant";
type Msg = { role: Role; content: string };

const ChatPane: React.FC = () => {
  const [model, setModel] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { const el = boxRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

  const canSend = useMemo(() => !!model && !!input.trim() && !streaming, [model, input, streaming]);

  const send = useCallback(async () => {
    if (!canSend) return;

    const userMsg: Msg = { role: "user", content: input.trim() };
    const history = [...messages, userMsg];

    setMessages(history);
    setInput("");
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamIdRef.current = null;

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson,application/json" },
        body: JSON.stringify({ model, messages: history }),
        signal: ctrl.signal
      });

      streamIdRef.current = res.headers.get("x-stream-id") || res.headers.get("x-request-id");

      if (!res.ok) {
        const t = await res.text().catch(()=> "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${t ? ` - ${t}` : ""}`);
      }

      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      for await (const chunk of ndjsonStream(res)) {
        let text = "";
        if (typeof chunk === "string") text = chunk;
        else if (typeof chunk.response === "string") text = chunk.response;
        else if (typeof chunk.token === "string") text = chunk.token;
        else if (typeof chunk.data === "string") text = chunk.data;

        if (text) {
          setMessages(prev => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") last.content += text;
            return copy;
          });
        }
        if ((chunk as any)?.done || (chunk as any)?.type === "done") break;
      }
    } catch (e: any) {
      if (!ctrl.signal.aborted) {
        setMessages(prev => [...prev, { role: "assistant", content: `⛔ ${e?.message || String(e)}` }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [canSend, input, messages, model]);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    try {
      const payload: Record<string, any> = {};
      if (streamIdRef.current) payload.streamId = streamIdRef.current;
      if (model) payload.model = model;
      await fetch("/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } catch {}
  }, [model]);

  const clear = useCallback(() => { if (!streaming) setMessages([]); }, [streaming]);

  return (
    <div className="grid gap-3">
      <div className="flex gap-2 items-end">
        <div className="flex-1"><ModelPicker value={model} onChange={setModel} /></div>
        <button className="border rounded px-3 py-1" onClick={clear} disabled={streaming || messages.length === 0}>Clear</button>
        <button className="border rounded px-3 py-1" onClick={stop} disabled={!streaming}>Stop</button>
      </div>

      <div ref={boxRef} className="border rounded p-2 h-64 overflow-auto bg-white">
        {messages.length === 0 ? (
          <div className="opacity-60 text-sm">No messages yet.</div>
        ) : messages.map((m, i) => (
          <div key={i} className="mb-3">
            <div className="text-xs opacity-60 mb-0.5">{m.role.toUpperCase()}</div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input className="border rounded px-2 py-1 flex-1" value={input} onChange={(e)=>setInput(e.target.value)}
               placeholder="Type a message…" onKeyDown={(e)=>{ if (e.key==="Enter" && !e.shiftKey){ e.preventDefault(); send(); }}} />
        <button className="border rounded px-3 py-1" onClick={send} disabled={!canSend}>Send</button>
      </div>
    </div>
  );
};

export default ChatPane;
