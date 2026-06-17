/**
 * One-shot: fetches SlashEvaluated event for each known slash block and backfills sharpe_at_eval.
 * Arc testnet RPC only returns logs reliably for exact block queries, not ranges.
 */
import { parseAbi, decodeEventLog } from "viem";
import { getPublicClient, getDeployedAddresses } from "@phronos/shared";
import { rawSql } from "@phronos/db";

const SLASH_ORACLE_ABI = parseAbi([
  "event SlashEvaluated(uint256 indexed erc8004Id, uint16 bpsSlashed, int256 sharpeAtEval)",
]);

const TOPIC_SLASH_EVALUATED = "0xbfaba56224dc968165dbcd9a352ed567e00b98d65fa05eae0430a19e436246f3";

async function main() {
  const client = getPublicClient();
  const { slashOracle } = getDeployedAddresses();
  if (!slashOracle) { console.error("SLASH_ORACLE_ADDR not set"); process.exit(1); }

  const sql = rawSql();
  const slashes = await sql`SELECT erc8004_id, block_number FROM slashes WHERE sharpe_at_eval = '0' ORDER BY block_number`;
  console.log(`Backfilling ${slashes.length} slashes…`);

  for (const slash of slashes as Array<{ erc8004_id: string; block_number: string }>) {
    const blk = BigInt(slash.block_number);
    const agentId = Number(slash.erc8004_id);

    const logs = await client.getLogs({ address: slashOracle, fromBlock: blk, toBlock: blk });
    const evalLog = logs.find(l => l.topics[0] === TOPIC_SLASH_EVALUATED);
    if (!evalLog) {
      console.log(`  block=${blk} agent=${agentId}: no SlashEvaluated log`);
      continue;
    }

    const decoded = decodeEventLog({ abi: SLASH_ORACLE_ABI, eventName: "SlashEvaluated", data: evalLog.data, topics: evalLog.topics });
    const sharpeStr = (Number(decoded.args.sharpeAtEval) / 1e18).toFixed(18);
    await sql`UPDATE slashes SET sharpe_at_eval = ${sharpeStr} WHERE erc8004_id = ${agentId} AND block_number = ${Number(blk)}`;
    console.log(`  block=${blk} agent=${agentId}: sharpe=${sharpeStr} ✓`);
  }

  console.log("Backfill complete.");
}

main().catch(e => { console.error(e); process.exit(1); });
