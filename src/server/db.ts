import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Runtime connection. In production DATABASE_URL is Supabase's transaction pooler (port 6543): each
 * serverless instance keeps a small pool and the pooler shares the real connections. node-postgres
 * sends unnamed statements, which the transaction pooler supports.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const max = Number(process.env.DATABASE_POOL_MAX) || (process.env.VERCEL ? 3 : 10);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max, idleTimeoutMillis: 10_000 }) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
