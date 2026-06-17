export const dynamic    = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { rawSql } from "@phronos/db";

export async function POST(req: Request) {
  try {
    const { erc8004Id, name, description, strategyType, market, createdBy } = await req.json();
    if (!erc8004Id || !name || !createdBy) {
      return NextResponse.json({ error: "erc8004Id, name, createdBy required" }, { status: 400 });
    }
    const sql = rawSql();
    await sql`
      INSERT INTO agent_metadata (erc8004_id, name, description, strategy_type, market, created_by)
      VALUES (${Number(erc8004Id)}, ${String(name)}, ${String(description ?? "")},
              ${String(strategyType ?? "Custom")}, ${String(market ?? "BTC")}, ${String(createdBy)})
      ON CONFLICT (erc8004_id) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description,
            strategy_type = EXCLUDED.strategy_type, market = EXCLUDED.market
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
