import { prisma } from "@repo/db";
import type { FastifyPluginAsync } from "fastify";

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const session = await prisma.analysisSession.findUnique({
      where: { id: request.params.id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        analyses: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { snapshots: true, charts: true },
        },
      },
    });

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    return session;
  });
};
