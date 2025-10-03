import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import ModelPicker from "./ModelPicker";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import SettingsModal from "./SettingsModal";

/* ================= Theme ================= */
type ThemeKind = "light" | "dark" | "system";
function setPalette(kind: Exclude<ThemeKind, "system">) {
  const DARK = {
    bg: "#111318",
    fg: "#E7EAF0",
    panel: "#15181F",
    sidebar: "#101217",
    bubbleUserBg: "#E7EAF0",
    bubbleUserFg: "#0F1319",
    bubbleAssistantBg: "#171A21",
    bubbleAssistantFg: "#E7EAF0",
    codeBg: "#0E1217",
    border: "rgba(255,255,255,0.08)",
  };
  const LIGHT = {
    bg: "#FFFFFF",
    fg: "#0B1420",
    panel: "#F5F7FA",
    sidebar: "#EFF2F6",
    bubbleUserBg: "#EEF2F8",
    bubbleUserFg: "#0B1420",
    bubbleAssistantBg: "#FFFFFF",
    bubbleAssistantFg: "#0B1420",
    codeBg: "#F6F8FB",
    border: "rgba(11,20,32,0.12)",
  };
  const p = kind === "dark" ? DARK : LIGHT;
  const r = document.documentElement;

  r.style.setProperty("--bg", p.bg);
  r.style.setProperty("--fg", p.fg);
  r.style.setProperty("--panel", p.panel);
  r.style.setProperty("--sidebar", p.sidebar);
  r.style.setProperty("--bubble-user-bg", p.bubbleUserBg);
  r.style.setProperty("--bubble-user-fg", p.bubbleUserFg);
  r.style.setProperty("--bubble-assistant-bg", p.bubbleAssistantBg);
  r.style.setProperty("--bubble-assistant-fg", p.bubbleAssistantFg);
  r.style.setProperty("--code-bg", p.codeBg);
  r.style.setProperty("--border", p.border);

  (r as HTMLElement).style.colorScheme = kind;
  r.classList.toggle("dark", kind === "dark");
}
function applyTheme(pref: ThemeKind) {
  const sysDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  const eff: Exclude<ThemeKind, "system"> = pref === "system" ? (sysDark ? "dark" : "light") : pref;
  setPalette(eff);
  document.documentElement.dataset.theme = eff;
}

/* =============== Types & helpers =============== */
type Role = "user" | "assistant";
type ChatMessage = { role: Role | "system"; content: string };
type Message = {
  id: string;
  role: Role;
  content: string;
  think?: string;
  isStreaming?: boolean;
  isThinking?: boolean;
  thinkMs?: number;
};
type Chat = { id: string; title: string; createdAt: number; updatedAt: number; messages: Message[] };
type ModelOptions = { temperature: number; top_p: number; repeat_penalty?: number };

const STORAGE_CHATS = "argon_chats_v2";
const STORAGE_ACTIVE = "argon_active_chat_v2";
const STORAGE_THEME  = "argon_theme_v2";
const STORAGE_USER   = "argon_user_v2";

const SYS_PROMPT: ChatMessage = { role: "system", content: "You are Argon. Be concise and helpful." };
function isThinkingModel(name: string) {
  return /(\br1\b|deepseek|think|reason|qwen[-_]?think|argon[_:-]?think)/i.test(name || "");
}
function titleFromMessages(msgs: Message[]): string {
  const firstUser = msgs.find((m) => m.role === "user");
  const raw = firstUser?.content || "New chat";
  return raw.length > 40 ? raw.slice(0, 40) + "…" : raw;
}

/* ===================== Main Pane ===================== */
export default function ChatPane() {
  /* theme */
  const [theme, setTheme] = useState<ThemeKind>(
    (localStorage.getItem(STORAGE_THEME) as ThemeKind) || "dark"
  );
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_THEME, theme);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyTheme("system");
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    }
  }, [theme]);

  /* user */
  const [user, setUser] = useState<{ name: string; email: string }>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_USER) || "") || {
        name: "Moiz",
        email: "user@example.com",
      };
    } catch {
      return { name: "Moiz", email: "user@example.com" };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_USER, JSON.stringify(user));
    } catch {}
  }, [user]);

  /* model & opts */
  const [model, setModel] = useState<string>("");
  const [options, setOptions] = useState<ModelOptions>({ temperature: 0.6, top_p: 0.9, repeat_penalty: 1.1 });

  /* chats */
  const [{ chats, activeId }, setStore] = useState<{ chats: Chat[]; activeId: string | null }>(() => {
    try {
      const arr: Chat[] = JSON.parse(localStorage.getItem(STORAGE_CHATS) || "[]");
      const active = localStorage.getItem(STORAGE_ACTIVE);
      if (arr.length) return { chats: arr, activeId: active || arr[0].id };
    } catch {}
    const blank: Chat = { id: crypto.randomUUID(), title: "New chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    return { chats: [blank], activeId: blank.id };
  });
  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) || chats[0], [chats, activeId]);
  const [messages, setMessages] = useState<Message[]>(activeChat?.messages ?? []);
  useEffect(() => setMessages(activeChat?.messages ?? []), [activeId]);

  /* persist messages -> store */
  useEffect(() => {
    if (!activeChat) return;
    const updated: Chat = {
      ...activeChat,
      title: activeChat.messages.length ? titleFromMessages(activeChat.messages) : activeChat.title,
      updatedAt: Date.now(),
      messages,
    };
    const next = chats.map((c) => (c.id === activeChat.id ? updated : c));
    setStore({ chats: next, activeId });
    try {
      localStorage.setItem(STORAGE_CHATS, JSON.stringify(next));
      if (activeId) localStorage.setItem(STORAGE_ACTIVE, activeId);
    } catch {}
  }, [messages]);

  /* sidebar actions */
  const onNewChat = () => {
    const c: Chat = { id: crypto.randomUUID(), title: "New chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    const next = [c, ...chats];
    setStore({ chats: next, activeId: c.id });
    setMessages([]);
    window.scrollTo({ top: 0 });
  };
  const onSelectChat = (id: string) => {
    setStore({ chats, activeId: id });
    const target = chats.find((c) => c.id === id);
    setMessages(target?.messages ?? []);
    window.scrollTo({ top: 0 });
  };
  const onDeleteChat = (id: string) => {
    const next = chats.filter((c) => c.id !== id);
    const nextActive = next.length ? next[0].id : null;
    setStore({ chats: next, activeId: nextActive });
    setMessages(next.find((c) => c.id === nextActive)?.messages ?? []);
  };
  const onSaveChat = (id: string) => {
    const c = chats.find((x) => x.id === id);
    if (!c) return;
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (c.title || "chat") + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const onRenameChat = (id: string, title: string) => {
    const next = chats.map((c) => (c.id === id ? { ...c, title } : c));
    setStore({ chats: next, activeId });
  };
  const onDeleteAll = () => {
    setStore({ chats: [], activeId: null });
    setMessages([]);
    try {
      localStorage.setItem(STORAGE_CHATS, "[]");
      localStorage.removeItem(STORAGE_ACTIVE);
    } catch {}
  };

  /* streaming (Composer) */
  const streamingIdRef = useRef<string | null>(null);
  const parseRef = useRef<{
    phase: "thinking" | "answer";
    buf: string;
    think: string;
    answer: string;
    t0?: number;
    t1?: number;
    sawOpen: boolean;
    sawClose: boolean;
  } | null>(null);

  const handleUserMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }]);
    window.scrollTo({ top: document.body.scrollHeight });
  }, []);

  const handleStart = useCallback(() => {
    const id = crypto.randomUUID();
    streamingIdRef.current = id;

    const startingPhase: "thinking" | "answer" = isThinkingModel(model) ? "thinking" : "answer";
    parseRef.current = {
      phase: startingPhase,
      buf: "",
      think: "",
      answer: "",
      t0: startingPhase === "thinking" ? performance.now() : undefined,
      sawOpen: false,
      sawClose: false,
    };

    setMessages((prev) => [
      ...prev,
      { id, role: "assistant", content: "", think: "", isStreaming: true, isThinking: startingPhase === "thinking", thinkMs: undefined },
    ]);
  }, [model]);

  const handleToken = useCallback((token: string) => {
    const P = (parseRef.current ??= {
      phase: "answer" as const,
      buf: "",
      think: "",
      answer: "",
      sawOpen: false,
      sawClose: false,
    });

    P.buf += token;

    const emit = () => {
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.id === streamingIdRef.current);
        if (idx === -1) return next;
        next[idx] = {
          ...next[idx],
          content: P.answer,
          think: P.think,
          isStreaming: true,
          isThinking: P.phase === "thinking",
          thinkMs: P.phase === "answer" && P.t0 && P.t1 ? P.t1 - P.t0 : next[idx].thinkMs,
        };
        return next;
      });
    };

    while (P.buf.length) {
      if (P.phase === "thinking") {
        if (!P.sawOpen) {
          const i = P.buf.indexOf("<think>");
          if (i !== -1) {
            P.sawOpen = true;
            P.buf = P.buf.slice(i + "<think>".length);
            continue;
          } else {
            P.buf = "";
            break;
          }
        }
        const j = P.buf.indexOf("</think>");
        if (j === -1) {
          P.think += P.buf;
          P.buf = "";
          emit();
          break;
        } else {
          P.think += P.buf.slice(0, j);
          P.buf = P.buf.slice(j + "</think>".length);
          P.sawClose = true;
          P.phase = "answer";
          P.t1 = P.t1 ?? performance.now();
          emit();
        }
      } else {
        P.answer += P.buf;
        P.buf = "";
        emit();
        break;
      }
    }
  }, []);

  const finalizeStreamingMessage = useCallback(() => {
    const P = parseRef.current;
    setMessages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((m) => m.id === streamingIdRef.current);
      if (idx !== -1) {
        const thinkMs = P && P.t0 ? Math.max(0, (P.t1 ?? performance.now()) - P.t0) : next[idx].thinkMs;
        const hadText = (next[idx].content || "").trim().length > 0 || (next[idx].think || "").trim().length > 0;
        if (hadText) {
          next[idx] = { ...next[idx], isStreaming: false, isThinking: false, thinkMs };
        } else {
          next.splice(idx, 1);
        }
      }
      return next;
    });
    streamingIdRef.current = null;
    parseRef.current = null;
  }, []);

  const handleDone = useCallback((_meta: any) => {
    finalizeStreamingMessage();
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }, [finalizeStreamingMessage]);

  const handleError = useCallback((msg: string) => {
    if (/aborted|aborterror|The user aborted/i.test(msg || "")) {
      finalizeStreamingMessage();
      return;
    }
    setMessages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((m) => m.id === streamingIdRef.current);
      const err = `[Error: ${msg}]`;
      if (idx !== -1) {
        const prevMsg = next[idx];
        const hadText = (prevMsg.content || prevMsg.think || "").trim().length > 0;
        if (hadText) {
          next[idx] = {
            ...prevMsg,
            isStreaming: false,
            isThinking: false,
            content: (prevMsg.content ? prevMsg.content + "\n\n" : "") + err,
          };
        } else {
          next.splice(idx, 1);
        }
      } else {
        next.push({ id: crypto.randomUUID(), role: "assistant", content: err, isStreaming: false, isThinking: false });
      }
      return next;
    });
    streamingIdRef.current = null;
    parseRef.current = null;
  }, [finalizeStreamingMessage]);

  const handleStop = useCallback(() => {
    finalizeStreamingMessage();
  }, [finalizeStreamingMessage]);

  /*rag upload */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onUploadClick = () => fileRef.current?.click();
  const onFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/rag/upload", { method: "POST", body: fd });
      if (!r.ok) throw new Error(`Upload failed (${r.status})`);
      // Optionally show a toast
    } catch (err: any) {
      alert(String(err?.message || err));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* settings modal */
  const [openSettings, setOpenSettings] = useState(false);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      <Sidebar
        fixed
        chats={chats.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt }))}
        activeId={activeId}
        onNewChat={onNewChat}
        onSelect={onSelectChat}
        onDelete={onDeleteChat}
        onSave={onSaveChat}
        onRename={onRenameChat}
        userDisplayName={user.name}
        onOpenSettings={() => setOpenSettings(true)}
      />

      <div className="transition-[padding-left] duration-300 ease-out" style={{ paddingLeft: "var(--sbw, 240px)" }}>
        {/* Header */}
        <header className="sticky top-0 z-10 px-4 py-3 border-b border-white/10" style={{ background: "var(--bg)" }}>
          <div className="mx-auto flex w-full max-w-[900px] items-center gap-3">
            <div className="text-sm opacity-70">Model:</div>
            <ModelPicker model={model} onChange={setModel} />
            <div className="ml-auto flex items-center gap-2">
              {/* Paper-clip upload for RAG */}
              <button
                className="rounded-full bg-white/10 hover:bg-white/20 px-3 py-2 text-sm"
                title="Attach file for RAG"
                onClick={onUploadClick}
              >
                📎
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md,.doc,.docx"
                className="hidden"
                onChange={onFilesChosen}
              />
            </div>
          </div>
        </header>

        {/* Messages */}
        <main className="pb-[120px] pt-3 sm:pt-4">
          <div className="mx-auto w-full max-w-[860px] px-3 sm:px-4">
            {messages.length === 0 ? (
              <div className="py-10 text-center text-sm opacity-70">
                Start a conversation by choosing a model and typing below.
              </div>
            ) : (
              <div className="space-y-2">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    id={m.id}
                    role={m.role}
                    content={m.content}
                    think={m.think}
                    isStreaming={!!m.isStreaming}
                    isThinking={!!m.isThinking}
                    thinkMs={m.thinkMs}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* Composer */}
        <div
          className="fixed bottom-0 right-0 z-10 px-4 py-4 border-t border-white/10"
          style={{ left: "var(--sbw, 240px)", background: "var(--bg)" }}
        >
          <div className="mx-auto w-full max-w-[860px] px-3 sm:px-4">
            <Composer
              model={model || undefined}
              prependMessages={[SYS_PROMPT]}
              onUserMessage={handleUserMessage}
              onStart={handleStart}
              onToken={handleToken}
              onDone={handleDone}
              onError={handleError}
              onStop={handleStop}
            />
          </div>
        </div>
      </div>
      <Composer
  model={model || undefined}
  history={messages.map(m => ({ role: m.role, content: m.content }))}
  prependMessages={[{ role: "system", content: "You are Argon. Be concise and helpful." }]}

  onUserMessage={handleUserMessage}
  onStart={handleStart}
  onToken={handleToken}
  onDone={handleDone}
  onError={handleError}
  onStop={handleStop}
/>


      {openSettings && (
        <SettingsModal
          onClose={() => setOpenSettings(false)}
          theme={theme}
          onChangeTheme={setTheme}
          options={options}
          onChangeOptions={setOptions}
          user={user}
          onChangeUser={setUser}
          chats={chats}
          onExport={() => {
            const blob = new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "argon_chats.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          onDeleteAll={onDeleteAll}
        />
      )}
    </div>
  );
}
