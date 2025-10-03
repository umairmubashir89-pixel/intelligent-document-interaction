import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  selectModel,
  streamChat,
  uploadRagFile,
  ragQuery,
  deleteRagFile,
} from "./lib/api";
import type { ChatMessage } from "./lib/api";
import "../styles.css";

/* ───────────────────────── Types / Utils ───────────────────────── */
type Role = "user" | "assistant";
type Msg = { id: string; role: Role; content: string; think?: string; streaming?: boolean };
type Chat = {
  id: string;
  title: string;
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
  files?: Array<{ id: string; name: string }>;
};
type Theme = "light" | "dark" | "system";
const DEFAULT_MODEL = "gemma3:12b"; // change here if your local name differs

const LS_CHATS = "argon_chats";
const LS_PROFILE = "argon_profile";
const LS_THEME = "argon_theme";

const cx = (...xs: Array<string | false | undefined>) => xs.filter(Boolean).join(" ");
const now = () => Date.now();

/* expose to window */
declare global {
  interface Window {
    refreshFiles?: (chatId?: string) => Promise<void> | void;
    retryLastMessage?: () => void;
  }
}

/* ───────────────────── Cici‑like LIGHT Theme ───────────── */
function ThemeOverrides() {
  return (
    <style>{`
    :root[data-theme="light"], :root[data-theme="dark"] {
    --bg: #f7f9fc;
    --text: #111827;
    --muted: #6b7280;
    --panel-bg: #ffffff;
    --panel-border: #e5e7eb;
    --shadow: 0 8px 24px rgba(8, 86, 255, 0.86);
    --sidebar-bg: #ffffff;
    --sidebar-border: #e5e7eb;
    --sidebar-text: #0249eee0;
    --sidebar-muted: #64748b;
    --bubble-user: #ff9900ff;
    --bubble-assistant: #ffffff;
    --btn:#14b8a6;
    --btn2:#3b82f6;
    --btn-text:#ffffff;
    --ring: rgba(59,130,246,.45);
    }


    html, body { background: var(--bg) !important; color: var(--text); }
    body, .app, .main, .chatwrap, .chatcol, .composer { background: transparent!important; }


    /* Sidebar */
    .sidebar {
    background: var(--sidebar-bg);
    border-right: 1px solid var(--sidebar-border);
    color: var(--sidebar-text);
    }
    .sidebar__head { padding: 14px 12px; display:flex; align-items:center; }
    .brand--header { font-weight: 800; letter-spacing: .5px; font-size: 20px; color: var(--sidebar-text); }
    .sidebar__new { padding: 10px 12px; }
    .sidebar__new button { width: 100%; padding: 10px 12px; border-radius: 12px; background: #f1f5f9; border: 1px solid var(--panel-border); color: var(--sidebar-text); box-shadow: var(--shadow); }
    .sidebar__caption { padding: 8px 12px; color: var(--sidebar-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .srow { padding: 8px 10px; min-height: 38px; gap: 8px; border-radius: 10px; }
    .srow--active { background: #eef2ff; }
    .srow__title { font-size: 14px; color: var(--sidebar-text); }
    .srow__menu { background: transparent; border:none; color: var(--sidebar-muted); }


    /* Hide user panel completely */
    .sidebar__footer, .user, .user-panel { display: none !important; }


    /* Wordmark */
    .hero { width:min(820px, 86vw); margin: 24px auto 8px; text-align:center; color:rgba(59, 131, 246, 0.91); font-weight:800; font-size: 44px; letter-spacing:.2px; }


    /* Chat feed */
    .chatwrap { overflow:auto; }
    .chatcol { width: min(900px, 84vw)!important; margin: 0 auto; }


    /* Bubbles */
    .bubble { background: var(--panel-bg); border: 1px solid var(--panel-border); color: var(--text); border-radius:16px; padding:18px 20px; box-shadow: var(--shadow); position: relative; }
    .bubble--user { background: var(--bubble-user); }


    /* Composer */
    .composer { gap: 8px; }
    .composer__box { width:min(900px, 86vw); margin: 0 auto; background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: 16px; padding: 6px 10px; box-shadow: var(--shadow); }
    .composer__box:focus-within { outline:1px solid var(--ring); box-shadow: 0 0 0 4px rgba(59, 131, 246, 0.91), var(--shadow); }
    .composer__input { background: transparent; border: none; color: #000 !important; caret-color: #000; font-size: 16px; padding: 10px 12px; }
    .composer__input::placeholder { color: #000; opacity: 0.45; }
    .composer__actions { display:flex; align-items:center; justify-content:flex-end; gap: 6px; }
    .attach { font-size: 0; }
    .attach::after { content: "📎"; font-size: 18px; display:inline-block; line-height: 1; color:#475569; }
    .send { background: linear-gradient(90deg, var(--btn), var(--btn2)); color: var(--btn-text); border-radius: 12px; padding: 10px 14px; border: none; }
    .send--stop { background:#ef4444; color:#fff; }


    /* Attachment chip */
    .attach-card{ position: relative; display: inline-flex; align-items: center; gap: 12px; padding: 12px 16px 12px 12px; border-radius: 16px; background: #ffffff; border: 1px solid var(--panel-border); box-shadow: var(--shadow); max-width: 360px; }
    .attach-icon{ width: 38px; height: 38px; min-width: 38px; border-radius: 12px; display:flex; align-items:center; justify-content:center; color: #fff; }
    .attach-icon.pdf { background: #ef4444; }
    .attach-icon.file { background: #64748b; }
    .attach-name{ color:#111827; font-weight:700; font-size:14px; line-height:1.2; max-width: 260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .attach-sub{ color:#64748b; font-size:12px; line-height:1.2; margin-top:3px; text-transform: uppercase; letter-spacing:.04em; }
    .attach-x{ position: absolute; top: -8px; right: -8px; width: 22px; height: 22px; border-radius: 999px; background: #ffffff; color: #0f172a; border: 1px solid var(--panel-border); display: inline-flex; align-items:center; justify-content:center; cursor: pointer; font-size: 14px; }


    /* Scrollbars */
    body, .chatwrap, .sidebar { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
    ::-webkit-scrollbar { width: 10px; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }

    /* Markdown */
    .codebox, .codebox pre { background: var(--code-bg)!important; color: var(--code-text)!important; }
    .inline-code { background: var(--code-inline-bg)!important; color: #1666e7ff!important; }
    .md-table-wrap{ overflow:auto; }
    .md-table{ border-collapse: collapse; width:100%; }
    .md-table th, .md-table td{ border:1px solid var(--table-border); padding:8px 10px; }
    .md-table tbody tr:nth-child(odd){ background: var(--table-row-alt); }
    `}</style>
  );
}

/* ───────────────────────── Markdown / Code ──────────────────── */
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(()=>setCopied(false), 900); } catch {} };
  const onDownload = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `snippet.${lang || "txt"}`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="codebox">
      <div className="codebox__bar">
        <span className="codebox__lang">{lang || "text"}</span>
        <div className="codebox__actions"><button onClick={onCopy} title="Copy">⧉</button><button onClick={onDownload} title="Download">⭳</button></div>
      </div>
      <pre><code>{code}</code></pre>
      {copied && <div className="copy-toast">Copied</div>}
    </div>
  );
}
function MarkdownView({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children }) {
          const src = String(children || "");
          const lang = /language-(\w+)/.exec(className || "")?.[1] || "text";
          return inline ? <code className="inline-code">{src}</code> : <CodeBlock code={src} lang={lang} />;
        },
        p({ children }) { return <p className="md-p">{children}</p>; },
        ul({ children }) { return <ul className="md-ul">{children}</ul>; },
        ol({ children }) { return <ol className="md-ol">{children}</ol>; },
        a({ href, children }) { return <a className="md-a" href={href} target="_blank" rel="noreferrer">{children}</a>; },
        table({ children }) { return <div className="md-table-wrap"><table className="md-table">{children}</table></div>; },
        thead({ children }) { return <thead>{children}</thead>; },
        tbody({ children }) { return <tbody>{children}</tbody>; },
        tr({ children }) { return <tr>{children}</tr>; },
        th({ children }) { return <th>{children}</th>; },
        td({ children }) { return <td>{children}</td>; },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/* ───────────────────────── Chat bubble ───────────────────────── */
function MessageBubble({ role, content, think }: { role: Role; content: string; think?: string }) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const onCopy = async () => { 
    try { 
      await navigator.clipboard.writeText(content); 
      setCopied(true); 
      setTimeout(() => setCopied(false), 900); 
    } catch {} 
  };

  const onRetry = () => {
    if (window.retryLastMessage) {
      window.retryLastMessage();
    }
  };

  return (
   <div
  className={cx("row", isUser ? "row--right" : "row--left")}
  style={{ marginBottom: 10, display: "flex", flexDirection: "column" }}
>

      <div className={cx("bubble", isUser ? "bubble--user" : "bubble--assistant")}>
        {!isUser && think !== undefined && think.trim() !== '' && (
          <details className="think-container" style={{ marginBottom: '12px', opacity: 0.7 }}>
            <summary style={{ fontSize: '14px', color: 'var(--muted)', fontStyle: 'italic', cursor: 'pointer', listStyle: 'none' }}>
              thinking…
            </summary>
            <pre className="think-content" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.9em', margin: '8px 0 0 0', padding: 0, color: 'var(--muted)', background: 'transparent', border: 'none', lineHeight: '1.4' }}>
              {think.trim()}
            </pre>
          </details>
        )}
        <MarkdownView text={content} />
      </div>

{/* Actions */}
<div
  className="bubble-actions"
  style={{
    justifyContent: isUser ? "flex-end" : "flex-start",
    alignSelf: isUser ? "flex-end" : "flex-start",
    width: "min(1200px, 60vw)",
    marginTop: "6px"
  }}
>
  <button className="action-btn" onClick={onCopy} title="Copy">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <rect x="2" y="2" width="13" height="13" rx="2" ry="2"></rect>
    </svg>
  </button>
  {!isUser && (
    <button className="action-btn" onClick={onRetry} title="Retry">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
    </button>
  )}
  {copied && <span className="copy-status">Copied</span>}
</div>

    </div>
  );
}

/* ───────────────────────── Model picker ───────────────────────── */
function ModelPicker({
  model, models, busy, onSelect, collapsed,
}: { model: string; models: string[]; busy: boolean; onSelect: (v: string) => void; collapsed: boolean }) {
  return (
    <div
      className="modelpicker"
      style={{
        margin: "10px 0 12px 15px",
        alignSelf: "flex-start",
        transition: "transform .25s ease",
        zIndex: 2,
      }}
    >
      <label className="modelpicker__label" style={{ marginRight: 8 }}>Model:</label>
      <select className="modelpicker__select" value={model} onChange={(e) => onSelect(e.target.value)} disabled={busy}>
        <option value="" disabled>Pick…</option>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      {busy && <span className="model-busy" style={{ marginLeft: 8, opacity: .8 }}>loading…</span>}
    </div>
  );
}

/* ───────────── Composer & Attachment chip ───────────── */
function AttachmentCard({
  file,
  onRemove,
}: {
  file: { id: string; name: string };
  onRemove: (id: string) => void;
}) {
  const ext = (/(\.(\w+)$)/.exec(file.name)?.[2] || "").toLowerCase();
  const label = ext ? ext.toUpperCase() : "FILE";
  const isPdf = ext === "pdf";

  return (
    <div className="attach-card sleek" title={file.name}>
      <div className={`attach-icon ${isPdf ? "pdf" : "file"}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M7 3h6l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="currentColor" opacity=".92" />
          <path d="M13 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>

      <div className="attach-meta">
        <strong className="attach-name" aria-label={file.name}>{file.name}</strong>
        <span className="attach-sub">{label}</span>
      </div>

      <button
        className="attach-x"
        onClick={() => onRemove(file.id)}
        title="Remove"
        aria-label="Remove attachment"
      >
        ×
      </button>
    </div>
  );
}

function Composer(props: {
  value: string;
  onChange: (s: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  fileChips: Array<{ id: string; name: string }>;
  onRemoveFile: (id: string) => void;
  onPickFile: (f: File) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const autoGrow = () => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = "auto";
    const lh = parseFloat(getComputedStyle(ta).lineHeight || "20");
    const max = lh * 8 + 22;
    ta.style.height = Math.min(ta.scrollHeight, max) + "px";
    ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
  };
  useEffect(() => { autoGrow(); }, [props.value]);

  return (
    <div className="composer" style={{ display:"flex", flexWrap:"wrap" }}>
      {props.fileChips.length > 0 && (
        <div className="attach-row" style={{ flexBasis:"100%", width:"100%", display:"flex", justifyContent:"center", flexWrap:"wrap", gap:8, margin:"0 0 10px 0" }}>
          {props.fileChips.map((f) => <AttachmentCard key={f.id} file={f} onRemove={props.onRemoveFile} />)}
        </div>
      )}

      <div className="composer__box" style={{ borderRadius:20, padding:12 }}>
        <textarea
          ref={taRef} className="composer__input" placeholder="Ask Anything…"
          value={props.value} onChange={(e) => props.onChange(e.target.value)} onInput={autoGrow}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); props.onSend(); } }}
          disabled={props.isStreaming}
        />
        <div className="composer__actions" style={{ display:"flex", alignItems:"center", gap:10 }}>
          <label className={cx("attach", props.isStreaming && "is-disabled")} title="Attach (RAG / Media)">
            <input hidden type="file" accept=".pdf,.txt,.md,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp" onChange={(e) => e.target.files && props.onPickFile(e.target.files[0])} disabled={props.isStreaming}/>
            📎
          </label>
          {!props.isStreaming ? <button className="send" onClick={props.onSend}>Send</button> : <button className="send send--stop" onClick={props.onStop}>Stop</button>}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Sidebar row ───────────────────────── */
function ChatRow({
  chat, active, onSelect, onRename, onDownload, onDelete, collapsed,
}: {
  chat: { id: string; title: string };
  active: boolean; collapsed: boolean;
  onSelect: (id: string) => void; onRename: (id: string) => void; onDownload: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as any)) setOpen(false); };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);
  return (
    <div className={cx("srow", active && "srow--active")} onClick={() => onSelect(chat.id)} title={chat.title} style={{ position:"relative" }}>
      {collapsed ? (
        <div className="srow__dot" data-tip={chat.title} />
      ) : (
        <>
          <div className="srow__title">{chat.title || "Untitled"}</div>
          <button className="srow__menu" onClick={(e) => { e.stopPropagation(); setOpen((x) => !x); }}>…</button>
          {open && (
            <div className="srow__popup" ref={ref} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setOpen(false); onRename(chat.id); }}>Rename</button>
              <button onClick={() => { setOpen(false); onDownload(chat.id); }}>Download</button>
              <button onClick={() => { setOpen(false); onDelete(chat.id); }}>Delete</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Settings Modal ───────────────────── */
type SettingsTab = "general" | "profile" | "data" | "about";
function SettingsModal({
  theme, setTheme, profile, setProfile, onExport, onDeleteAll, onClose,
}: {
  theme: Theme; setTheme: (t: Theme) => void;
  profile: { name: string; email: string }; setProfile: (p: {name: string; email: string}) => void;
  onExport: () => void; onDeleteAll: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__panel">
        <aside style={{ borderRight: "1px solid var(--panel-border)", paddingRight: 12, overflow:"auto" }}>
          {(["general","profile","data","about"] as SettingsTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ display:"block", width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, marginBottom:6, background: tab===t ? "#eef2ff" : "transparent", border:"1px solid var(--panel-border)", color:"var(--text)" }}
            >{t[0].toUpperCase()+t.slice(1)}</button>
          ))}
        </aside>
        <section className="modal__body" style={{ paddingTop: 0 }}>
          {tab === "general" && (
            <>
              <h2>General</h2>
              <div style={{ display: "flex", gap: 12 }}>
                {(["light","dark","system"] as Theme[]).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setTheme(opt)}
                    style={{ padding: "14px 18px", borderRadius: 14, border: "1px solid var(--panel-border)", background: theme===opt ? "#eef2ff" : "transparent", color:"var(--text)" }}
                  >{opt[0].toUpperCase()+opt.slice(1)}</button>
                ))}
              </div>
            </>
          )}
          {tab === "profile" && (
            <>
              <h2>Profile</h2>
              <label className="frow"><span>Name</span><input value={profile.name} onChange={(e)=>setProfile({...profile, name:e.target.value})} /></label>
              <label className="frow"><span>Email</span><input value={profile.email} onChange={(e)=>setProfile({...profile, email:e.target.value})} /></label>
            </>
          )}
          {tab === "data" && (
            <>
              <h2>Data</h2>
              <div className="frow"><span>Export all chats</span><button className="btn" onClick={onExport}>Export</button></div>
              <div className="frow"><span>Delete all chats</span><button className="btn btn--danger" onClick={onDeleteAll}>Delete all</button></div>
            </>
          )}
          {tab === "about" && (<><h2>About</h2><p>Doc Interactor UI • build {new Date().toISOString().slice(0,10)}</p></>)}
        </section>
        <button className="modal__close" onClick={onClose} aria-label="Close" style={{ position:"absolute", top:16, right:16 }}>✕</button>
      </div>
    </div>
  );
}

/* ───────────────────────────── App ──────────────────────────── */
export default function App() {
  /* title + favicon */
  useEffect(() => {
    document.title = "INTELLIGENT DOCUMENT INTERACTION";
    const svg = encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
        <rect width='64' height='64' rx='12' fill='#0ea5a3'/>
        <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'
          font-family='Inter,Segoe UI,Arial' font-size='36' fill='#ffffff'>D</text>
      </svg>`
    );
    const href = `data:image/svg+xml;charset=UTF-8,${svg}`;
    let link: HTMLLinkElement | null = document.querySelector("link[rel='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = href;
  }, []);

  /* theme */
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(LS_THEME) as Theme) || "light");
  useEffect(() => {
    if (theme === "system") {
      document.documentElement.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      document.documentElement.dataset.theme = theme;
    }
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  /* UI state */
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* profile */
  const [profile, setProfile] = useState<{name: string; email: string}>(() => {
    try { return JSON.parse(localStorage.getItem(LS_PROFILE) || "") || { name: "User", email: "user@example.com" }; }
    catch { return { name: "User", email: "user@example.com" }; }
  });
  useEffect(() => { localStorage.setItem(LS_PROFILE, JSON.stringify(profile)); }, [profile]);

  /* chats */
  const [chats, setChats] = useState<Chat[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_CHATS) || "[]"); } catch { return []; }
  });
  const [activeId, setActiveId] = useState<string>(() => (chats[0]?.id || ""));
  const active = useMemo(() => chats.find((c) => c.id === activeId) || null, [chats, activeId]);

  /* model */
  const [model, setModel] = useState<string>(DEFAULT_MODEL);

  /* compose / stream */
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  /* scroll helper */
  const chatWrapRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  useEffect(() => {
    const rootEl = chatWrapRef.current; const el = sentinelRef.current;
    if (!rootEl || !el) return;
    const io = new IntersectionObserver((entries) => setShowScrollDown(!entries[0]?.isIntersecting), { root: rootEl, threshold: 1.0 });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => { chatWrapRef.current?.scrollTo({ top: 1e9 }); }, [active?.messages.length]);

  /* init chats */
  useEffect(() => {
    if (!chats.length) {
      const c: Chat = {
        id: crypto.randomUUID(),
        title: "New chat",
        messages: [],
        files: [],
        createdAt: now(),
        updatedAt: now(),
      };
      setChats([c]);
      setActiveId(c.id);
    } else if (!activeId) {
      setActiveId(chats[0].id);
    }
  }, []);

  /* select the fixed default model once */
  useEffect(() => {
    setModel(DEFAULT_MODEL);
    selectModel(DEFAULT_MODEL).catch(() => {});
  }, []);
  useEffect(() => { localStorage.setItem(LS_CHATS, JSON.stringify(chats)); }, [chats]);

  const autoTitleFrom = (s: string) => {
    const clean = s.replace(/\s+/g, " ").trim();
    return clean.length <= 48 ? clean : clean.slice(0, 45) + "…";
  };

  /* RAG files refresh */
  const refreshFiles = useCallback(async (chatId?: string) => {
    const id = (chatId || activeId || "").trim();
    if (!id) { console.log("Frontend: No chatId provided for refreshFiles"); return; }
    try {
      const res = await fetch(`/rag/files?chatId=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list: Array<{ id: string; name: string }> = await res.json();
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, files: list } : c)));
    } catch (error) { console.error(`Frontend: Failed to refresh files for chatId="${id}":`, error); }
  }, [activeId]);

  /* send / stop */
  const [isStreaming, setIsStreaming] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = async () => {
    if (isStreaming || !activeId || !input.trim() || !model) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    setStopRequested(false);

    const firstUserText = input.trim();
    let user: Msg = { id: crypto.randomUUID(), role: "user", content: firstUserText };
    let assistant: Msg = { id: crypto.randomUUID(), role: "assistant", content: "", think: "", streaming: true };

    setChats(prev => {
      const idx = prev.findIndex(c => c.id === activeId);
      if (idx < 0) return prev;
      const c = prev[idx];
      const shouldAutoName = !c.title || /^new chat|untitled$/i.test(c.title);
      const titled = shouldAutoName ? autoTitleFrom(firstUserText) : c.title;
      const updated: Chat = { ...c, messages: [...c.messages, user, assistant], updatedAt: now(), title: titled };
      return prev.map((x,i) => i === idx ? updated : x);
    });
    setInput("");

    const existingBefore = (chats.find(c => c.id === activeId)?.messages || []) as Msg[];
    let acc = "", thinkAcc = "", inThink = false;

    const onToken = (token: string) => {
      if (stopRequested) return;
      const parts = token.split(/(<think>|<\/think>)/g);
      for (const p of parts) {
        if (p === "<think>") { inThink = true; continue; }
        if (p === "</think>") { inThink = false; continue; }
        if (inThink) thinkAcc += p; else acc += p;
      }
      setChats(prev => prev.map(c =>
        c.id === activeId
          ? { ...c, messages: [...existingBefore, user, { ...assistant, content: acc, think: thinkAcc, streaming: true }], updatedAt: now() }
          : c
      ));
    };

    let messages: ChatMessage[] = [{ role: "user", content: firstUserText }];
    const currentChat = chats.find(c => c.id === activeId);

    if ((currentChat?.files?.length || 0) > 0) {
      const hits = await ragQuery(user.content, activeId, 8);
      if (!hits || hits.length === 0) {
        // ...
        return;
      }
      const context = hits.join("\n---\n");
      messages = [{ role: "system", content: `Use ONLY the following context if relevant:\n${context}` }, ...messages];
    }

    try {
      await streamChat({ model, chatId: activeId, messages }, onToken, controller.signal);
    } catch (e: any) {
      if (e?.name !== "AbortError") acc += `\n> ⚠️ HTTP ${(e && e.status) || 500}`;
    } finally {
      setIsStreaming(false);
      setChats(prev => prev.map(c =>
        c.id === activeId
          ? { ...c, messages: [...existingBefore, user, { ...assistant, content: acc, think: thinkAcc, streaming: false }], updatedAt: now() }
          : c
      ));
    }
  };

  const retryLastMessage = useCallback(() => {
    const chat = chats.find(c => c.id === activeId);
    if (!chat || chat.messages.length < 2) return;

    const messages = chat.messages;
    const lastAssistantIndex = messages.length - 1;
    if (messages[lastAssistantIndex]?.role !== "assistant") return;

    const baseMessages = messages.slice(0, -1) as Msg[];
    const existingBefore = baseMessages;

    const assistant: Msg = { id: crypto.randomUUID(), role: "assistant", content: "", think: "", streaming: true };
    setChats(prev => prev.map(c =>
      c.id === activeId
        ? { ...c, messages: [...existingBefore, assistant], updatedAt: now() }
        : c
    ));

    (async () => {
      if (!model) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setStopRequested(false);

      let acc = "", thinkAcc = "", inThink = false;
      const onToken = (token: string) => {
        if (stopRequested) return;
        const parts = token.split(/(<think>|<\/think>)/g);
        for (const p of parts) {
          if (p === "<think>") { inThink = true; continue; }
          if (p === "</think>") { inThink = false; continue; }
          if (inThink) thinkAcc += p; else acc += p;
        }
        setChats(prev => prev.map(c =>
          c.id === activeId
            ? { ...c, messages: [...existingBefore, { ...assistant, content: acc, think: thinkAcc, streaming: true }], updatedAt: now() }
            : c
        ));
      };

      let modelMessages: ChatMessage[] = [];
      const lastUser = existingBefore[existingBefore.length - 1];
      if (lastUser?.role === "user") {
        modelMessages = [{ role: "user", content: lastUser.content }];
      } else {
        // Fallback: nothing to retry
        setIsStreaming(false);
        return;
      }

      const currentChat = chats.find(c => c.id === activeId);
      if ((currentChat?.files?.length || 0) > 0) {
        try {
          const lastUser = existingBefore[existingBefore.length - 1];
          const userText = lastUser?.role === "user" ? lastUser.content : "";
          const hits = await ragQuery(userText, activeId, 8);
          if (hits?.length) {
            const context = hits.join("\n---\n");
            modelMessages = [{ role: "system", content: `Use ONLY the following context if relevant:\n${context}` }, ...modelMessages];
          }
        } catch (e) { console.error("Frontend RAG query (retry) failed:", e); }
      }

      try {
        await streamChat({ model, chatId: activeId, messages: modelMessages }, onToken, controller.signal);
      } catch (e: any) {
        if (e?.name !== "AbortError") acc += `\n> ⚠️ HTTP ${(e && e.status) || 500}`;
      } finally {
        setIsStreaming(false);
        setChats(prev => prev.map(c =>
          c.id === activeId
            ? { ...c, messages: [...existingBefore, { ...assistant, content: acc, think: thinkAcc, streaming: false }], updatedAt: now() }
            : c
        ));
      }
    })();
  }, [activeId, chats, model]);

  useEffect(() => {
    window.retryLastMessage = retryLastMessage;
    return () => { delete window.retryLastMessage; };
  }, [retryLastMessage]);

  const stop = () => { setStopRequested(true); try { abortRef.current?.abort(); } catch {} setIsStreaming(false); };

  const onPickFile = async (f: File) => {
    const chatId = activeId;
    if (!f || !chatId) return;

    try {
      setToast(`Uploading ${f.name}…`);

      const name = f.name.toLowerCase();
      const mime = (f.type || '').toLowerCase();
      const isAudio = mime.startsWith('audio/') || /(mp3|wav|m4a|aac|ogg|flac)$/i.test(name);
      const isVideo = mime.startsWith('video/') || /(mp4|mov|mkv|webm|avi)$/i.test(name);
      if (isAudio || isVideo) {
        setToast('Audio/video uploads are disabled');
        setTimeout(() => setToast(null), 1200);
        return;
      }

      await uploadRagFile(f, chatId);
      await refreshFiles(chatId);
      setToast('Indexed ✓');
    } catch (e) {
      setToast('Upload failed');
    } finally {
      setTimeout(() => setToast(null), 1200);
    }
  };

  const removeChip = async (fileId: string) => {
    if (!activeId) return;
    try {
      await deleteRagFile(fileId);
      await refreshFiles(activeId);

      // After refresh, check if no files remain for this chat
      const chat = chats.find(c => c.id === activeId);
      const noFiles = (chat?.files?.length || 0) === 0;

      if (noFiles) {
        // 1) Clear server-side RAG store for this chat
        try { 
          await ragClear(activeId);
        } catch (e) {
          console.warn("ragClear failed:", e);
        }

        // 2) Clear all previous Q&A messages in this chat
        setChats(prev => prev.map(c => c.id === activeId ? { ...c, messages: [], updatedAt: Date.now() } : c));
      }
    } catch (e) {
      console.error(e);
    }
  };


  useEffect(() => { if (activeId) refreshFiles(activeId).catch(() => {}); setToast(null); }, [activeId, refreshFiles]);

  /* export / delete all */
  const exportAll = () => {
    const blob = new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `doc_interactor_chats_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(a.href);
  };
  const deleteAll = () => { if (!confirm("Delete ALL chats?")) return; setChats([]); setActiveId(""); localStorage.removeItem(LS_CHATS); };

  /* Layout */
  const COLLAPSED_W = 60;
  const EXPANDED_W = 243;
  const SIDEBAR_W = collapsed ? COLLAPSED_W : EXPANDED_W;

  const CONTENT_W = "60vw";
  const bottomMarginPx = 28;

  const headerRef = useRef<HTMLDivElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const [chatAreaPx, setChatAreaPx] = useState<number | null>(null);

  const recomputeHeights = useCallback(() => {
    const headerH = headerRef.current?.getBoundingClientRect().height ?? 0;
    const composerH = composerWrapRef.current?.getBoundingClientRect().height ?? 0;
    const safety = 12;
    const h = Math.max(120, window.innerHeight - headerH - composerH - bottomMarginPx - safety);
    setChatAreaPx(h);
  }, [bottomMarginPx]);

  useEffect(() => {
    recomputeHeights();
    const onResize = () => recomputeHeights();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recomputeHeights, collapsed, input, active?.files?.length]);

  /* chat list actions */
  const newChat = () => {
    const c: Chat = {
      id: crypto.randomUUID(),
      title: "New chat",
      messages: [],
      files: [],
      createdAt: now(),
      updatedAt: now(),
    };
    setChats((xs) => [c, ...xs]);
    setActiveId(c.id);
  };

  const renameChat = (id: string) => {
    const current = chats.find((c) => c.id === id);
    const title = prompt("Rename chat:", current?.title || "Untitled");
    if (title == null) return;
    setChats((xs) => xs.map((c) => (c.id === id ? { ...c, title: title.trim() || "Untitled", updatedAt: now() } : c)));
  };

  const downloadChat = (id: string) => {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    const blob = new Blob([JSON.stringify(chat, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(chat.title || "chat").replace(/[^\w.-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const deleteChat = (id: string) => {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    if (!confirm(`Delete chat "${chat.title || "Untitled"}"?`)) return;
    setChats((xs) => xs.filter((c) => c.id !== id));
    if (activeId === id) {
      const remaining = chats.filter((c) => c.id !== id);
      setActiveId(remaining[0]?.id || "");
    }
  };

  const isEmpty = !active || active.messages.length === 0;
  return (
    <div
      className="app"
      style={{
        display:"grid",
        gridTemplateColumns: `${SIDEBAR_W}px 1fr`,
        transition:"grid-template-columns .25s ease"
      }}
    >
      <ThemeOverrides />

      {/* Sidebar */}
      <aside className="sidebar" style={{ width: SIDEBAR_W }}>
        <div className="sidebar__head">
          <span className="brand--header">{collapsed ? "D" : "IDI"}</span>
          <button className="collapse" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"} style={{ marginLeft:"auto", background:"transparent", border:"1px solid var(--panel-border)", borderRadius:12, color:"var(--sidebar-text)", padding:"4px 8px" }}>
            {collapsed ? "»" : "«"}
          </button>
        </div>

        <div className="sidebar__new">
          <button onClick={newChat} aria-label="New chat">{collapsed ? "+" : "+ New"}</button>
        </div>
        <div className="sidebar__caption">{collapsed ? "" : "Library"}</div>
        <div className="sidebar__list">
          {chats.map((c) => (
            <ChatRow
              key={c.id}
              chat={c}
              active={c.id === activeId}
              collapsed={collapsed}
              onSelect={setActiveId}
              onRename={renameChat}
              onDownload={downloadChat}
              onDelete={deleteChat}
            />
          ))}
        </div>
      </aside>

      {/* Main column */}
      <main className="main" style={{ paddingBottom: 0 }}>
        <div ref={headerRef} style={{ paddingLeft: 15 }} />

        {/* Chat feed */}
        <div
          className="chatwrap"
          ref={chatWrapRef}
          style={{
            overflow:"auto",
            height: chatAreaPx ? `${chatAreaPx}px` : "calc(100vh - 190px)"
          }}
        >
          <div
            className="chatcol"
            style={{
              width: `min(1200px, ${CONTENT_W})`,
              margin: "0 auto",
              transition: "margin .25s ease"
            }}
          >
            {isEmpty ? (
              <div className="hero">INTELLIGENT DOCUMENT INTERACTION</div>
            ) : (
              active.messages.map((m) => (
                <MessageBubble key={m.id} role={m.role} content={m.content} think={m.think} />
              ))
            )}

            <div ref={sentinelRef} style={{ height: 1 }} />
          </div>
        </div>

        {/* Composer */}
        <div
          className="chatcol"
          ref={composerWrapRef}
          style={
            isEmpty
              ? {
                  position: "relative",
                  left: "unset",
                  transform: "none",
                  bottom: undefined as any,
                  width: "min(900px, 86vw)",
                  margin: "24px auto 40px",
                  background: "transparent",
                  zIndex: 5,
                }
              : {
                  position: "fixed",
                  left: `calc(${SIDEBAR_W}px + (100vw - ${SIDEBAR_W}px)/2)`,
                  transform: `translateX(-50%)`,
                  bottom: bottomMarginPx,
                  width: `min(1200px, 60vw)`,
                  margin: 0,
                  background: "transparent",
                  zIndex: 5,
                  transition: "left .25s ease",
                }
          }
        >
          {toast && <div className="toast">{toast}</div>}
          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={stop}
            onPickFile={onPickFile}
            isStreaming={isStreaming}
            fileChips={active?.files || []}
            onRemoveFile={removeChip}
          />
        </div>
      </main>

      {showScrollDown && (
        <button className="jump-bottom" aria-label="Jump to bottom" onClick={() => chatWrapRef.current?.scrollTo({ top: 1e9, behavior: "smooth" })}>↓</button>
      )}

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          setTheme={setTheme}
          profile={profile}
          setProfile={setProfile}
          onExport={exportAll}
          onDeleteAll={deleteAll}
          onClose={()=>setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
