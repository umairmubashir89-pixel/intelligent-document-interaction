import { retrieveTopK } from "./rag.js";

const OLLAMA_URL    = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gemma3:12b";

// Track active streaming requests so they can be stopped
const activeStreams = new Map<string, AbortController>();

// Simple ID generator
function generateRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Export function to stop all active streams (used by stop.ts)
export function stopAllActiveStreams(): number {
  const count = activeStreams.size;
  for (const [id, controller] of activeStreams.entries()) {
    controller.abort();
    activeStreams.delete(id);
  }
  return count;
}

export async function registerChatRoutes(app: any) {
  async function answer(messages: any[], model: string, k: number, fileIds?: string[], chatId?: string) {
    const last = String(messages[messages.length - 1]?.content || "").trim();
    const hits = await retrieveTopK(last, fileIds, k, chatId); // ⟵ changed order
    const context = hits.map(h => h.text).join("\n---\n");

    const withContext = context
      ? [{ role: "system", content: `Use ONLY the following context if relevant:\n${context}` }, ...messages]
      : messages;

    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: withContext }),
    });
    return r;
  }

  app.post("/chat", async (req: any, reply: any) => {
    const body     = req.body || {};
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const model    = String(body?.model || DEFAULT_MODEL);
    const k        = typeof body?.k === "number" ? body.k : 10;
    const fileIds  = Array.isArray(body?.fileIds) ? body.fileIds : undefined;
    const chatId   = typeof body?.chatId === "string" ? body.chatId.trim() : undefined;

    const r = await answer(messages, model, k, fileIds, chatId);
    const j = await r.json();
    reply.send(j);
  });

app.post("/chat/stream", async (req: any, reply: any) => {
  const body     = req.body || {};
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const model    = String(body?.model || DEFAULT_MODEL);
  const k        = typeof body?.k === "number" ? body.k : 10;
  const fileIds  = Array.isArray(body?.fileIds) ? body.fileIds : undefined;
  const chatId   = typeof body?.chatId === "string" ? body.chatId.trim() : undefined;

  // DEBUG: Log the incoming parameters
  console.log(`Chat stream request: chatId="${chatId}", k=${k}, fileIds=${JSON.stringify(fileIds)}`);

  // Create abort controller for this stream
  const requestId = generateRequestId();
  const abortController = new AbortController();
  activeStreams.set(requestId, abortController);

  // compute context once; then stream tokens from Ollama
  const last = String(messages[messages.length - 1]?.content || "").trim();
  
  // DEBUG: Log RAG query parameters
  console.log(`About to call retrieveTopK with: query="${last.slice(0,50)}...", fileIds=${JSON.stringify(fileIds)}, k=${k}, chatId="${chatId}"`);
  
  const hits = await retrieveTopK(last, fileIds, k, chatId);
  
  // DEBUG: Log RAG results
  console.log(`RAG hits received: ${hits.length} chunks`);
  
  const context = hits.map(h => h.text).join("\n---\n");
  const withContext = context
    ? [{ role: "system", content: `Use ONLY the following context if relevant:\n${context}` }, ...messages]
    : messages;

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");

    try {
      const GEN_NUM_CTX = Number(process.env.GEN_NUM_CTX || 32768);

      const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: withContext,
          stream: true, // Explicitly enable streaming
          options: {
            // keep it conservative to avoid hallucinations with long contexts
            temperature: 0.2,
            num_ctx: GEN_NUM_CTX,   // ← larger context window for long answers
            num_predict: -1
          }
        }),
        signal: abortController.signal // THIS IS THE KEY ADDITION - allows stopping
      });

      if (!r.ok || !r.body) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: "upstream error" })}\n\n`);
        return reply.raw.end();
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        // Check if request was aborted
        if (abortController.signal.aborted) {
          reply.raw.write(`event: stopped\ndata: ${JSON.stringify({ message: "generation stopped" })}\n\n`);
          break;
        }

        const { value, done } = await reader.read();
        if (done) break;
        const lines = dec.decode(value).split("\n").map(s => s.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const j = JSON.parse(line);
            const token = j?.message?.content || j?.response || "";
            if (token) reply.raw.write(`data: ${JSON.stringify({ token })}\n\n`);
          } catch {}
        }
      }
      reply.raw.write(`event: done\ndata: {}\n\n`);
      reply.raw.end();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // This is expected when we stop the generation
        reply.raw.write(`event: stopped\ndata: ${JSON.stringify({ message: "generation stopped" })}\n\n`);
      } else {
        req.log.error(err);
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: "chat stream failed" })}\n\n`);
      }
      reply.raw.end();
    } finally {
      // Always clean up the tracking
      activeStreams.delete(requestId);
    }
  });
}