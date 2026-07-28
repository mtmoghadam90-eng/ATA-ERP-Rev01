import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";

/**
 * Single Prisma client for the process.
 *
 * One instance, because each one owns a connection pool: creating them per
 * request exhausts SQL Server's connections under concurrent use — which is the
 * exact scenario this migration exists to support.
 *
 * Prisma 7 no longer ships a built-in SQL Server connector; it connects through
 * a driver adapter (`@prisma/adapter-mssql`, which wraps the `mssql` driver).
 * Without one the client throws "requires a driver adapter" on the first query,
 * so the adapter is not optional. It accepts the same JDBC-style string as
 * DATABASE_URL, keeping one connection string for both the app and the CLI.
 *
 * The adapter's own pool (`mssql` default: max 10 connections) is what limits
 * concurrency, not this module.
 */
let client: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL تنظیم نشده است؛ فایل .env را از .env.example بسازید.",
      );
    }
    client = new PrismaClient({
      adapter: new PrismaMssql(url),
      log: ["warn", "error"],
    });
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/** True when a DATABASE_URL is configured at all. */
export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/** Connectivity probe used by /api/db-health and startup checks. */
export async function pingDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
