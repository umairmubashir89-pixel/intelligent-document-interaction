import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Composer from "./components/Composer";
import MessageBubble from "./components/MessageBubble";
import Sidebar from "./components/Sidebar";
import SettingsModal from "./components/SettingsModal";
import ModelPicker from "../../components/ModelPicker";
import type { ChatMessage } from "../../../lib/api/stream";
import type { ModelOptions } from "../../components/SettingsBar";

type Role = "user" | "assistant";
interface Message {
  id: string;
  role: Role;
  content: string;
  think?: string;
  isStreaming?: boolean;
  isThinking?: boolean;
  thinkMs?: number;
}
interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

const DEFAULT_OPTIONS: ModelOptions = { temperature: 0.6, top_p: 0.9, repeat_penalty: 1.1 };
const STORAGE_KEY = "argon_chats_v1";
const STORAGE_ACTIVE = "argon_active_chat_v1";
const THEME_KEY = "argon_theme";
const USER_KEY = "argon_user_v1";

type ThemeKind = "light" | "dark" | "system";

/* ---------------------- Fixed palettes ---------------------- */
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
  localStorage.setItem(THEME_KEY, pref);
}

/* ---------------------- Helpers ---------------------- */
function isThinkingModel(name: string) {
  return /(\br1\b|deepseek|think|reason|qwen[-_]?think|argon[_:-]?think)/i.test(name || "");
}
function titleFromMessages(msgs: Message[]): string {
  const firstUser = msgs.find((m) => m.role === "user");
  const raw = firstUser?.content || "New chat";
  return raw.length > 40 ? raw.slice(0, 40) + "…" : raw;
}
function loadChats(): { chats: Chat[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const chats: Chat[] = raw ? JSON.parse(raw) : [];
    return { chats };
  } catch {
    return { chats: [] };
  }
}
function saveChats(chats: Chat[], activeId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    if (activeId) localStorage.setItem(STORAGE_ACTIVE, activeId);
  } catch {}
}
async function stopServerModel(model?: string) {
  if (!model) return;
  try {
    await fetch("/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
  } catch {}
}
async function selectAndWarmModel(model: string, prev?: string) {
  const r = await fetch("/models/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prev, keepAlive: "30m" }),
  });
  if (!r.ok) {
    let msg = `Failed to start "${model}" (${r.status})`;
    try {
      const j = await r.json();
      if (j?.error) msg = String(j.error);
    } catch {}
    throw new Error(msg);
  }
}

/* =============================== Page =============================== */
export default function ChatRoute() {
  // theme
  const [theme, setTheme] = useState<ThemeKind>(
    (localStorage.getItem(THEME_KEY) as ThemeKind) || "system"
  );
  useEffect(() => {
    applyTheme(theme);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyTheme("system");
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    }
  }, [theme]);

  // user
  const [user, setUser] = useState<{ name: string; email: string }>(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "") || {
        name: "Moiz",
        email: "user@example.com",
      };
    } catch {
      return { name: "Moiz", email: "user@example.com" };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {}
  }, [user]);

  // model/options
  const [model, setModel] = useState<string>("");
  const [options, setOptions] = useState<ModelOptions>(DEFAULT_OPTIONS);

  // chats
  const [{ chats, activeId }, setStore] = useState<{ chats: Chat[]; activeId: string | null }>(() => {
    const { chats: loaded } = loadChats();
    const fresh: Chat = {
      id: crypto.randomUUID(),
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    return { chats: [fresh, ...loaded], activeId: fresh.id };
  });
  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) || null, [chats, activeId]);
  const [messages, setMessages] = useState<Message[]>(activeChat?.messages ?? []);
  useEffect(() => setMessages(activeChat?.messages ?? []), [activeId]);

  // persist chat updates
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
    saveChats(next, activeId);
  }, [messages]);

  // sidebar actions
  const onNewChat = () => {
    const c: Chat = {
      id: crypto.randomUUID(),
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    const next = [c, ...chats];
    setStore({ chats: next, activeId: c.id });
    setMessages([]);
    saveChats(next, c.id);
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
    saveChats(next, nextActive);
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
    saveChats(next, activeId);
  };
  const onDeleteAllChats = () => {
    setStore({ chats: [], activeId: null });
    setMessages([]);
    saveChats([], null);
  };

  // scrolling / autoscroll
  const streamingIdRef = useRef<string | null>(null);
  const autoscrollRef = useRef<boolean>(true);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const THRESH = 120;
    const onScroll = () => {
      const nearBottom =
        window.innerHeight + window.scrollY >=
        (document.scrollingElement || document.documentElement).scrollHeight - THRESH;
      setAtBottom(nearBottom);
      autoscrollRef.current = nearBottom;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // stream parse state
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

  const historyForApi: ChatMessage[] = useMemo(
    () => messages.map((m) => ({ role: m.role, content: m.content })),
    [messages]
  );

  const handleUserMessage = useCallback((text: string) => {
    const msg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((prev) => [...prev, msg]);
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
      {
        id,
        role: "assistant",
        content: "",
        think: "",
        isStreaming: true,
        isThinking: startingPhase === "thinking",
        thinkMs: undefined,
      },
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
        const hadText =
          (next[idx].content || "").trim().length > 0 || (next[idx].think || "").trim().length > 0;
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
    stopServerModel(model);
  }, [finalizeStreamingMessage, model]);

  // Immediate model switch handler (abort stream, stop old, warm new)
  const handleModelChange = useCallback(async (nextModel: string) => {
    const prev = model;

    // Switch immediately (Composer aborts current stream on model prop change)
    setModel(nextModel);

    // Stop the previously running model on the server so it drops from `ollama ps`
    if (prev && prev !== nextModel) {
      stopServerModel(prev).catch(() => {});
    }

    // Warm the selected model now (pull if needed, keep alive)
    if (nextModel) {
      try {
        await selectAndWarmModel(nextModel, prev);
      } catch (e: any) {
        alert(String(e?.message || e));
        // Revert UI if warm fails
        setModel(prev || "");
      }
    }
  }, [model]);

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

      <div style={{ paddingLeft: "var(--sbw, 240px)" }} className="transition-[padding-left] duration-300 ease-out">
        <header className="sticky top-0 z-10 px-4 py-3" style={{ background: "var(--bg)" }}>
          <div className="relative mx-auto w-full max-w-[900px]">
            <ModelPicker model={model} onChange={handleModelChange} />
          </div>
        </header>

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

        <div
          className="fixed bottom-0 right-0 z-10 px-4 py-4"
          style={{ left: "var(--sbw, 240px)", background: "var(--bg)" }}
        >
          <Composer
            model={model || undefined}
            prependMessages={messages.map((m) => ({ role: m.role, content: m.content }))}
            onUserMessage={handleUserMessage}
            onStart={handleStart}
            onToken={handleToken}
            onDone={handleDone}
            onError={handleError}
            onStop={handleStop}
            optionsOverride={options}
          />
        </div>
      </div>

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
          onDeleteAll={onDeleteAllChats}
        />
      )}
    </div>
  );
}
