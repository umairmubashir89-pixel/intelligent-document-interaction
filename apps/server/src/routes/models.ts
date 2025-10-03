// apps/server/src/routes/models.ts
import type { FastifyInstance } from "fastify";

/**
 * Ollama base URL. Example: http://127.0.0.1:11434
 */
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

/**
 * In-memory selected model. (Persist however you like if needed.)
 */
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3:12b";
let currentModel = DEFAULT_MODEL;

/**
 * Keep track of running models to stop them when switching
 */
let runningModels = new Set<string>();

/**
 * Stop a specific model or all running models
 */
async function stopModel(modelName?: string) {
  try {
    if (modelName) {
      // Stop specific model
      await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          prompt: "",
          stream: false,
          options: { stop: true }
        }),
      });
      runningModels.delete(modelName);
    } else {
      // Stop all running models
      const stopPromises = Array.from(runningModels).map(async (model) => {
        try {
          await fetch(`${OLLAMA_URL}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: model,
              prompt: "",
              stream: false,
              options: { stop: true }
            }),
          });
        } catch {
          // Individual model stop failed, continue with others
        }
      });
      
      await Promise.allSettled(stopPromises);
      runningModels.clear();
    }
  } catch {
    // swallow: stopping should not break the app
  }
}

/**
 * Alternative method to unload model from memory
 */
async function unloadModel(modelName: string) {
  try {
    // This tells Ollama to unload the model from memory
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        prompt: "",
        keep_alive: 0 // This unloads the model immediately
      }),
    });
    runningModels.delete(modelName);
  } catch {
    // swallow: unloading should not break the app
  }
}

/**
 * Best-effort pull (non-blocking) so layers are present.
 */
async function pullModel(name: string) {
  try {
    await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {
    // swallow: we don't want to block selection on pull errors
  }
}

/**
 * Best-effort warmup (non-blocking) so first user message is instant.
 */
async function warmModel(name: string) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: name,
        stream: false,
        messages: [{ role: "user", content: "hello" }],
        keep_alive: "5m" // Keep model loaded for 5 minutes
      }),
    });
    
    if (response.ok) {
      runningModels.add(name);
    }
  } catch {
    // swallow: warming should not break the app
  }
}

/**
 * Fetch list of local models from Ollama. Never throws; always returns array.
 */
async function listOllamaModels(): Promise<string[]> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) return [];
    const data: any = await r.json();
    const models = Array.isArray(data?.models) ? data.models.map((m: any) => m.name) : [];
    return models.filter((s: any) => typeof s === "string" && s.length > 0);
  } catch {
    return [];
  }
}

export async function registerModelRoutes(app: FastifyInstance) {
  // ────────────────────────────────────────────────────────────────────
  // GET models (new + legacy paths)
  // ────────────────────────────────────────────────────────────────────
  app.get("/api/models", async (_req, reply) => {
    const models = await listOllamaModels();
    return reply.send({ models });
  });

  app.get("/models", async (_req, reply) => {
    const models = await listOllamaModels();
    return reply.send({ models });
  });

  // ────────────────────────────────────────────────────────────────────
  // POST select model (new + legacy paths)
  // body: { model: string }
  // Stop previous models, then pull + warm the new model
  // ────────────────────────────────────────────────────────────────────
  app.post("/api/model/select", async (req, reply) => {
    const body: any = req.body || {};
    const model = String(body?.model || "").trim();
    if (!model) return reply.code(400).send({ ok: false, error: "model required" });

    const previousModel = currentModel;
    currentModel = model;

    // Fire-and-forget model switching process
    (async () => {
      try {
        // Step 1: Stop/unload previous model if it exists and is different
        if (previousModel && previousModel !== model) {
          await unloadModel(previousModel);
          // Also try stopping it in case it's still processing
          await stopModel(previousModel);
        }

        // Step 2: Stop all other running models to be safe
        if (runningModels.size > 0) {
          await stopModel(); // Stop all running models
        }

        // Step 3: Pull and warm the new model
        await pullModel(model);
        await warmModel(model);
      } catch (error) {
        console.error(`Error switching to model ${model}:`, error);
      }
    })().catch(() => void 0);

    return reply.send({ ok: true, model, previousModel });
  });

  app.post("/model/select", async (req, reply) => {
    const body: any = req.body || {};
    const model = String(body?.model || "").trim();
    if (!model) return reply.code(400).send({ ok: false, error: "model required" });

    const previousModel = currentModel;
    currentModel = model;

    (async () => {
      try {
        if (previousModel && previousModel !== model) {
          await unloadModel(previousModel);
          await stopModel(previousModel);
        }

        if (runningModels.size > 0) {
          await stopModel();
        }

        await pullModel(model);
        await warmModel(model);
      } catch (error) {
        console.error(`Error switching to model ${model}:`, error);
      }
    })().catch(() => void 0);

    return reply.send({ ok: true, model, previousModel });
  });

  // ────────────────────────────────────────────────────────────────────
  // POST stop current model
  // ────────────────────────────────────────────────────────────────────
  app.post("/api/model/stop", async (_req, reply) => {
    if (currentModel) {
      await stopModel(currentModel);
      await unloadModel(currentModel);
    }
    return reply.send({ ok: true, stopped: currentModel || "none" });
  });

  app.post("/model/stop", async (_req, reply) => {
    if (currentModel) {
      await stopModel(currentModel);
      await unloadModel(currentModel);
    }
    return reply.send({ ok: true, stopped: currentModel || "none" });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET current model (handy for UI to reflect state)
  // ────────────────────────────────────────────────────────────────────
  app.get("/api/model/current", async (_req, reply) => {
    return reply.send({ 
      model: currentModel || "",
      runningModels: Array.from(runningModels)
    });
  });

  app.get("/model/current", async (_req, reply) => {
    return reply.send({ 
      model: currentModel || "",
      runningModels: Array.from(runningModels)
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET running models status
  // ────────────────────────────────────────────────────────────────────
  app.get("/api/models/status", async (_req, reply) => {
    return reply.send({
      currentModel: currentModel || "",
      runningModels: Array.from(runningModels),
      totalRunning: runningModels.size
    });
  });
}

/**
 * Export a getter so other routes (chat, rag, etc.) can use the same selection.
 * Falls back to a sensible default if nothing selected.
 */
export function getCurrentModel(): string {
  return currentModel || process.env.DEFAULT_MODEL || "gemma3:12b";
}

/**
 * Export function to get running models
 */
export function getRunningModels(): string[] {
  return Array.from(runningModels);
}

/**
 * Export function to manually stop a model (useful for cleanup)
 */
export async function stopModelManually(modelName: string): Promise<void> {
  await stopModel(modelName);
  await unloadModel(modelName);
}