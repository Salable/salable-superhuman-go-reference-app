import { PrismaClient } from '@prisma/client';

// Standard Next.js singleton so hot reloads don't exhaust connections locally.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
