import 'dotenv/config';
import Fastify from "fastify";
import cors from "@fastify/cors";
import { analysisRoutes } from "./routes/analysis.js";
import { sessionRoutes } from "./routes/sessions.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: false, // internal service, no public CORS needed
});

// Internal auth hook — validates INTERNAL_API_SECRET header
app.addHook("onRequest", async (request, reply) => {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return; // skip in dev if not set

  const authHeader = request.headers["x-internal-secret"];
  if (authHeader !== secret) {
    await reply.status(401).send({ error: "Unauthorized" });
  }
});

await app.register(analysisRoutes, { prefix: "/analysis" });
await app.register(sessionRoutes, { prefix: "/sessions" });

app.get("/health", async () => ({ status: "ok" }));

const port = parseInt(process.env.API_PORT ?? "3001", 10);
const host = process.env.API_HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
