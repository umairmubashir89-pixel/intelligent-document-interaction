import React, { useMemo } from "react";

function renderMarkdown(md: string) {
  // very small MD support w/ fenced code detection
  const parts: Array<{ type: "code" | "p"; lang?: string; body: string }> = [];
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    if (m.index > last) parts.push({ type: "p", body: md.slice(last, m.index) });
    parts.push({ type: "code", lang: (m[1] || "").toLowerCase(), body: m[2] });
    last = m.index + m[0].length;
  }
  if (last < md.length) parts.push({ type: "p", body: md.slice(last) });
  return parts;
}

export default function MessageBubble(props: { role: "user" | "assistant" | "system"; content: string }) {
  const mine = props.role === "user";
  const blocks = useMemo(() => renderMarkdown(props.content), [props.content]);

  return (
    <div className={`w-full flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? "bg-blue-600 text-white" : "bg-zinc-900 border border-zinc-800"}`}>
        {blocks.map((b, i) =>
          b.type === "p" ? (
            <p key={i} className="whitespace-pre-wrap leading-7">{b.body}</p>
          ) : (
            <CodeBlock key={i} lang={b.lang!} code={b.body} />
          )
        )}
      </div>
    </div>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  function copy() {
    navigator.clipboard.writeText(code);
  }
  function download() {
    const a = document.createElement("a");
    const blob = new Blob([code], { type: "text/plain" });
    a.href = URL.createObjectURL(blob);
    a.download = `snippet${lang ? "." + lang : ""}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="my-3 rounded-xl overflow-hidden border border-zinc-800">
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-950 text-zinc-400 text-xs">
        <span>{lang || "code"}</span>
        <div className="flex gap-2">
          <button onClick={copy} className="hover:text-zinc-200">copy</button>
          <button onClick={download} className="hover:text-zinc-200">download</button>
        </div>
      </div>
      <pre className="bg-zinc-900 p-3 overflow-auto text-sm"><code>{code}</code></pre>
    </div>
  );
}
