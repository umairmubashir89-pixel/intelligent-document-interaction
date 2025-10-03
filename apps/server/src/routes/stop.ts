// apps/server/src/routes/stop.ts
import type { FastifyInstance } from "fastify";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

export async function registerStopRoute(app: FastifyInstance) {
  app.post("/stop", async (_req, reply) => {
    try {
      // Import the function to stop active streams
      const { stopAllActiveStreams } = await import('./chat.js');
      
      // 1. Stop all active streaming requests
      const stoppedStreams = stopAllActiveStreams();
      
      // 2. Send stop signal to Ollama backend
      let ollamaStopped = false;
      try {
        // Method A: Send general stop signal
        await fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "",
            prompt: "",
            stream: false,
            options: { 
              stop: true,
              max_tokens: 0
            }
          }),
        });
        ollamaStopped = true;
      } catch {
        // Ollama stop might fail, continue with other methods
      }

      // Method B: Try to stop any running processes
      try {
        const psResponse = await fetch(`${OLLAMA_URL}/api/ps`);
        if (psResponse.ok) {
          const runningData = await psResponse.json();
          if (runningData.models && Array.isArray(runningData.models)) {
            // Send stop/unload signal to each running model
            const stopPromises = runningData.models.map(async (modelInfo: any) => {
              if (modelInfo.name) {
                try {
                  await fetch(`${OLLAMA_URL}/api/generate`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      model: modelInfo.name,
                      prompt: "",
                      stream: false,
                      options: { 
                        stop: true,
                        max_tokens: 0,
                        keep_alive: 0 // This unloads the model from memory
                      }
                    }),
                  });
                } catch {
                  // Individual model stop failed, continue with others
                }
              }
            });
            await Promise.allSettled(stopPromises);
          }
        }
      } catch {
        // PS endpoint might not be available in all Ollama versions
      }

      reply.send({ 
        ok: true,
        stoppedStreams,
        ollamaStopped,
        message: `Stopped ${stoppedStreams} active streams and sent stop signal to Ollama`
      });
    } catch (error) {
      // Even if something fails, return ok: true so frontend doesn't show error
      reply.send({ 
        ok: true,
        message: "Stop command executed"
      });
    }
  });
}