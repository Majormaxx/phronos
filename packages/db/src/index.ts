import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export * from "./schema.js";
export { eq, sql, gt, lt, gte, lte, and, or, desc, asc, inArray } from "drizzle-orm";

// No module-level singleton: Next.js 14 caches `neon()` client fetch responses
// when the same client instance is reused across requests. Fresh instance per call
// goes through Next.js's `force-dynamic` opt-out correctly.
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = neon(process.env.DATABASE_URL);
  return drizzle(client, { schema });
}
