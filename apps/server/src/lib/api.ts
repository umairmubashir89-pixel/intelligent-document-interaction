// Frontend API helpers for Argon Web UI (chat-scoped RAG)

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

const BASE = location.origin;

async function asJson<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${txt || r.statusText}`);
  }
  return (await r.json()) as T;
}

/* ========================= Models ========================= */

export async function fetchModels(): Promise<{ models: string[]; current?: string } | string[]> {
  const r = await fetch(`${BASE}/api/models`);
  try { return await asJson<any>(r); } catch { return []; }
}

export async function selectModel(name: string) {
  const r = await fetch(`${BASE}/api/model/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name }),
  });
  return asJson<{ ok: boolean }>(r);
}

/* ========================= Chat stream =========================
   Server should scope any RAG usage using chatId passed here.
*/
export async function streamChat(
  body: { model: string; messages: ChatMessage[]; chatId?: string },
  onToken: (t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const r = await fetch(`${BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) {
    const e: any = new Error("HTTP " + r.status);
    e.status = r.status;
    throw e;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = dec.decode(value);
    for (const line of text.split("\n").map(s => s.trim()).filter(Boolean)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      try {
        const j = JSON.parse(payload);
        if (j?.token) onToken(j.token);
      } catch {}
    }
  }
}

/* ========================= RAG (chat-scoped) ========================= */

// ✅ synchronous: server blocks until pdf → chunks → vectors are saved
export async function uploadRagFile(file: File, chatId: string) {
  const form = new FormData();
  form.append("file", file);
  return fetch(`/rag/upload?chatId=${encodeURIComponent(chatId)}`, {
    method: "POST",
    body: form,
  }).then(r => {
    if (!r.ok) throw new Error(`upload failed: ${r.status}`);
    return r.json();
  });
}


export async function ragQuery(query: string, chatId: string, k = 8): Promise<string[]> {
  const r = await fetch(`${BASE}/rag/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, k, chatId }),
  });
  const j = await asJson<{ ok: boolean; hits: string[] }>(r);
  return j.hits || [];
}

export async function deleteRagFile(fileId: string): Promise<void> {
  const r = await fetch(`${BASE}/rag/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
}

