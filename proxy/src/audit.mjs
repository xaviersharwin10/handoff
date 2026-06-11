/**
 * On-chain audit logging. After the gateway enforces a grant, it records the
 * decision as an `AccessLogged` event on Sui, signed by the gateway key. The
 * dashboard reads the log from chain — durable and tamper-evident.
 *
 * Only meaningful decisions on a real grant are logged (allow, or deny for
 * revoked/expired/bad-signature). Garbage/spam requests are not, so the gateway
 * can't be made to burn gas on nonexistent grants. The per-IP rate limit caps it.
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { config } from "./config.mjs";

const client = new SuiJsonRpcClient({ url: config.suiRpcUrl || getJsonRpcFullnodeUrl("testnet"), network: "testnet" });

function hexToBytes(h) {
  const c = h.startsWith("0x") ? h.slice(2) : h;
  const o = new Uint8Array(c.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16);
  return o;
}

const keypair = Ed25519Keypair.fromSecretKey(hexToBytes(config.delegateKey));

const isAddr = (s) => typeof s === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(s);

const AUDIT_DISABLED = process.env.GATEWAY_DISABLE_AUDIT === "1";

/** Fire-and-forget: emit AccessLogged for a real-grant decision. Never throws. */
export function logAccessOnChain(e) {
  if (AUDIT_DISABLED) return; // tests/CI: skip on-chain audit (avoids gas-key contention)
  if (!isAddr(e.grantId) || !isAddr(e.memwalAccount)) return; // skip spam/garbage
  (async () => {
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${config.handoffPackageId}::grants::log_access`,
        arguments: [
          tx.pure.address(e.grantId),
          tx.pure.address(e.memwalAccount),
          tx.pure.string(e.granteeLabel || ""),
          tx.pure.string(e.namespace || ""),
          tx.pure.bool(Boolean(e.allowed)),
          tx.pure.string(e.reason || ""),
          tx.pure.u64(Number(e.resultCount) || 0),
          tx.object("0x6"),
        ],
      });
      tx.setGasBudget(10_000_000);
      await keypair.signAndExecuteTransaction({ transaction: tx, client });
    } catch (err) {
      console.warn("[audit] on-chain log failed:", String(err?.message || err));
    }
  })();
}

export const gatewayAddress = keypair.toSuiAddress();
