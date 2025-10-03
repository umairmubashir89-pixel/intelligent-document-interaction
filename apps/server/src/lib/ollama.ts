// apps/server/src/lib/ollama.ts
export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
  seed?: number;
  mirostat?: number;
  num_ctx?: number;
  num_predict?: number;
  stop?: string[];
}

export interface OllamaChatParams {
  model: string;
  messages: ChatMessage[];
  options?: OllamaOptions;
}

export interface StreamHandlers {
  onToken: (t: string) => void;
  onError: (e: Error) => void;
  onDone: (meta: any) => void;
}

function getBase(): string {
  const raw =
    process.env.OLLAMA_HOST ||
    process.env.OLLAMA_BASE_URL ||
    "http://127.0.0.1:11434";
  return String(raw).replace(/\/+$/, "");
}

function composePrompt(messages: ChatMessage[]): string {
  const sys = messages.find((m) => m.role === "system")?.content?.trim();
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role.toUpperCase()}: ${m.content.trim()}`)
    .join("\n\n");
  return (sys ? `SYSTEM: ${sys}\n\n` : "") + turns + "\n\nASSISTANT:";
}

export function streamGenerate(
  params: OllamaChatParams,
  handlers: StreamHandlers
): () => void {
  const ctrl = new AbortController();
  const { signal } = ctrl;

  const body = {
    model: params.model,
    prompt: composePrompt(params.messages || []),
    stream: true,
    options: params.options ?? {},
  };

  (async () => {
    try {
      const res = await fetch(`${getBase()}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          `Ollama HTTP ${res.status} ${res.statusText}${txt ? ` — ${txt}` : ""}`
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
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
          try {
            const obj = JSON.parse(s);
            if (obj.error) {
              handlers.onError(new Error(String(obj.error)));
            } else if (typeof obj.response === "string") {
              handlers.onToken(obj.response);
            }
            if (obj.done) {
              handlers.onDone(obj);
            }
          } catch (e: any) {
            handlers.onError(
              new Error(`Invalid NDJSON from Ollama: ${e?.message || String(e)}`)
            );
          }
        }
      }
    } catch (e: any) {
      if (signal.aborted) return;
      handlers.onError(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return () => {
    try {
      ctrl.abort();
    } catch {}
  };
}

export async function generateOnce(params: OllamaChatParams) {
  const res = await fetch(`${getBase()}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      prompt: composePrompt(params.messages || []),
      stream: false,
      options: params.options ?? {},
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Ollama HTTP ${res.status} ${res.statusText}${txt ? ` — ${txt}` : ""}`
    );
  }

  const data = await res.json();
  const text = typeof data?.response === "string" ? data.response : "";
  return { text, meta: data };
}
