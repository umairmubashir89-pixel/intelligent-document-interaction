// apps/server/src/index.ts
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerModelRoutes } from "./routes/models.js";   // ← keep your file unchanged
import { registerRagRoutes } from "./routes/rag.js";
import { registerChatRoutes } from "./routes/chat.js";

// ──────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const BODY_LIMIT = MAX_UPLOAD_MB * 1024 * 1024;

// ──────────────────────────────────────────────────────────────
// App bootstrap
// ──────────────────────────────────────────────────────────────
const app = Fastify({
  logger: true,
  bodyLimit: BODY_LIMIT,
});

// CORS & multipart
await app.register(fastifyCors, { origin: true });
await app.register(fastifyMultipart, {
  limits: {
    fileSize: BODY_LIMIT,
    files: 10,
    fields: 200,
    fieldSize: 500 * 1024 * 1024, // 500 MB per field
  },
});

// Static: serve built web app if present (apps/web/dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDist = path.resolve(__dirname, "../../web/dist");
try {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.log.info(`Static UI served from: ${webDist}`);
} catch (e) {
  app.log.warn(`Static UI not found at ${webDist} (dev mode is fine).`);
}

// Health
app.get("/health", async (_req, reply) => reply.send({ ok: true }));

// ──────────────────────────────────────────────────────────────
/** Route registration order is not critical, but we keep it tidy. */
// ──────────────────────────────────────────────────────────────
await registerModelRoutes(app);    // your existing model selector routes
await registerRagRoutes(app);      // upload/index/query/answer/chat (RAG)
await registerChatRoutes(app);     // general chat endpoints with RAG context injection

// 404 handler
app.setNotFoundHandler((_req, reply) =>
  reply.code(404).send({ ok: false, error: "Not found" })
);

// Start server
app
  .listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`Server listening on http://${HOST}:${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
