/**
 * Circle Gateway Nanopayments — seller-side middleware.
 *
 * Wraps Express routes with a 402 Payment Required gate using Circle's x402
 * protocol. Callers must attach a signed EIP-3009 TransferWithAuthorization
 * header before their request reaches the tool handler.
 *
 * Usage (seller):
 *   app.get("/tool/leaderboard", gateway.require("$0.001"), handler)
 *
 * The facilitatorUrl points to Circle's testnet Gateway API which validates
 * the payment signature and settles on Arc Testnet automatically.
 */
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import type { RequestHandler } from "express";

const SELLER_ADDRESS = (
  process.env.GATEWAY_SELLER_ADDRESS ??
  process.env.OPERATOR_ADDRESS ??
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

const FACILITATOR_URL = "https://gateway-api-testnet.circle.com";

export const gateway = createGatewayMiddleware({
  sellerAddress: SELLER_ADDRESS,
  facilitatorUrl: FACILITATOR_URL,
});

// Convenience: returns the middleware for a given price string (e.g. "$0.001")
export function requirePayment(price: string): RequestHandler {
  return gateway.require(price) as unknown as RequestHandler;
}
