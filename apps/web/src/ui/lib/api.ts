// Frontend API helpers for Argon Web UI (chat + RAG + transcription)
// Merged from the two previous API files to keep one authoritative source.

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

const BASE = location.origin;

/* ---------------------------- utils ---------------------------- */

async function asJson<T>(r: Response): Promise<T> {
  if (!r.ok) {
    // Try to surface server error text for easier debugging
    const txt = await r.text().catch(() => "");
    const error = new Error(`HTTP ${r.status} ${txt || r.statusText}`);
    throw error;
  }
  return (await r.json()) as T;
}

/* ========================= Models ========================= */

/**
 * Fetch the available model list.
 * Older code expected string[], newer code may expect { models: string[], current?: string }.
 * We return the union to be safe.
 */
export async function fetchModels(): Promise<{ models: string[]; current?: string } | string[]> {
  const r = await fetch(`${BASE}/api/models`);
  try {
    return await asJson<any>(r);
  } catch {
    // Fallback for servers that reply with a plain array
    return [];
  }
}

/** Select the active model by name. */
export async function selectModel(name: string): Promise<{ ok: boolean }> {
  const r = await fetch(`${BASE}/api/model/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name }),
  });
  return asJson<{ ok: boolean }>(r);
}

/* ========================= Chat (SSE Stream) ========================= */

/**
 * POST to /chat/stream and invoke `onToken` for each streamed token.
 * Optional `chatId` allows the server to scope RAG to a specific chat.
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

  // Robust SSE-ish parsing: read chunks, split into lines, look for "data:" JSON envelopes.
  const reader = r.body.getReader();
  const dec = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const text = dec.decode(value);
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      try {
        const obj = JSON.parse(payload);
        if (obj?.token) onToken(obj.token);
      } catch {
        // ignore malformed lines
      }
    }
  }
}

/* ========================= RAG ========================= */

/**
 * Upload a file for RAG.
 * Overloads let older code (no chatId / void return) keep working,
 * while newer chat-scoped RAG returns {id, name}.
 */
export async function uploadRagFile(file: File): Promise<void>;
export async function uploadRagFile(file: File, chatId: string): Promise<{ id: string; name: string }>;
export async function uploadRagFile(
  file: File,
  chatId?: string
): Promise<void | { id: string; name: string }> {
  const fd = new FormData();
  fd.append("file", file, file.name);

  if (chatId) {
    // Chat-scoped upload
    const r = await fetch(`${BASE}/rag/upload?chatId=${encodeURIComponent(chatId)}`, {
      method: "POST",
      body: fd,
    });
    const j = await asJson<{ ok: boolean; file: { id: string; name: string } }>(r);
    return { id: j.file.id, name: j.file.name };
  } else {
    // Legacy/global upload
    const r = await fetch(`${BASE}/rag/upload`, { method: "POST", body: fd });
    // Legacy handler had no response body consumers; just ensure HTTP OK.
    await asJson<any>(r).catch(() => {}); // tolerate servers that return no JSON
    return;
  }
}

/**
 * Query the RAG store for relevant snippets.
 * FIXED: Use correct parameter names and ensure chatId is always passed
 */
export async function ragQuery(query: string): Promise<string[]>;
export async function ragQuery(query: string, chatId: string, k?: number): Promise<string[]>;
export async function ragQuery(query: string, chatId?: string, k = 8): Promise<string[]> {
  // CRITICAL FIX: Use 'question' not 'query' to match backend expectation
  const body: any = { question: query, topK: k };
  
  // CRITICAL FIX: Always include chatId when provided
  if (chatId) {
    body.chatId = chatId;
    console.log(`Frontend ragQuery: sending chatId="${chatId}" with question="${query.slice(0, 50)}..."`);
  } else {
    console.warn("Frontend ragQuery: No chatId provided - this may cause cross-chat pollution!");
  }

  const r = await fetch(`${BASE}/rag/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  
  const j = await asJson<{ ok: boolean; chunks?: Array<{ text: string }> }>(r);
  const chunks = j.chunks || [];
  console.log(`Frontend ragQuery: received ${chunks.length} chunks for chatId="${chatId}"`);
  
  return chunks.map(c => c.text);
}

/** Delete a file from the RAG store (by fileId). */
export async function deleteRagFile(fileId: string): Promise<void> {
  const r = await fetch(`${BASE}/rag/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  if (!r.ok) {
    const e: any = new Error("HTTP " + r.status);
    e.status = r.status;
    throw e;
  }
}

export async function ragClear(chatId: string) {
  const res = await fetch("/rag/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId }),
  });
  if (!res.ok) throw new Error(`ragClear HTTP ${res.status}`);
}
