/**
 * Capture-token minting (server-only). MUST stay byte-identical to the proxy's
 * verifier in proxy/src/capture.mjs: token = hoc_<b64url(accountId)>_<hmac tag>,
 * tag = HMAC-SHA256(master, "capture:"+accountId).toLowerCase().slice(0,32).
 *
 * The token is a stateless, write-only capture credential: whoever holds it can
 * append captured memories to that one account's vault (and nothing else). No DB.
 */
import "server-only";
import { createHmac } from "node:crypto";

const MASTER = process.env.HANDOFF_MASTER_SECRET;
if (!MASTER) throw new Error("HANDOFF_MASTER_SECRET is not set");
const masterBytes = Buffer.from(MASTER, "hex");

export function mintCaptureToken(accountId: string): string {
  const tag = createHmac("sha256", masterBytes)
    .update("capture:" + accountId.toLowerCase())
    .digest("hex")
    .slice(0, 32);
  const acct = Buffer.from(accountId).toString("base64url");
  return `hoc_${acct}_${tag}`;
}
