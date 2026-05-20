import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!_db) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    const client = postgres(process.env.DATABASE_URL, { max: 5 });
    _db = drizzle(client, { schema });
  }
  return _db;
}
