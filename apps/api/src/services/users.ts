import { prisma } from "@repo/db";
import type { User } from "@repo/db";

export async function getOrCreateUser(
  telegramId: string,
  username?: string
): Promise<User> {
  const existing = await prisma.user.findUnique({
    where: { telegramId },
  });

  if (existing) {
    if (username && existing.username !== username) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { username },
      });
    }
    return existing;
  }

  return prisma.user.create({
    data: { telegramId, username },
  });
}
