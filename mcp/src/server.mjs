#!/usr/bin/env node
/**
 * Handoff MCP server. Drop it into any MCP-capable agent (Claude Desktop, Cursor,
 * Windsurf, …). The agent gets three tools backed by a single Handoff grant — it
 * can read AND write the ONE memory slice the user granted, scoped/expiring/
 * revocable and audited on-chain, and nothing else.
 *
 * Config (per agent's MCP settings): set HANDOFF_GRANT_ID, HANDOFF_CREDENTIAL_KEY,
 * and HANDOFF_GATEWAY_URL in the server's env.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clientFromEnv } from "@handoff/sdk";

const handoff = clientFromEnv();

const server = new McpServer({ name: "handoff", version: "0.1.0" });

server.tool(
  "recall_memory",
  "Recall the slice of the user's memory you've been granted. Returns ONLY the granted category; scope, expiry and revocation are enforced on-chain by the Handoff gateway. Use this whenever you need a user preference, fact, or context the user chose to share.",
  { query: z.string().describe("What to look up in the user's shared memory, e.g. 'dietary preferences'") },
  async ({ query }) => {
    const r = await handoff.recall(query);
    if (!r.allowed) {
      return { content: [{ type: "text", text: `Access denied (${r.reason}). The user controls this on-chain — ask them to grant access.` }] };
    }
    if (r.results.length === 0) {
      return { content: [{ type: "text", text: `No matching memory in the granted "${r.namespace}" category.` }] };
    }
    return { content: [{ type: "text", text: r.results.map((m) => `• ${m.text}`).join("\n") }] };
  },
);

server.tool(
  "remember_memory",
  "Save a durable fact or finding into the user's memory, inside the ONE category you've been granted. Use it for things worth keeping across sessions (decisions, findings, preferences you learned). The write is provenance-tagged with your agent name, audited on-chain, and the user can permanently shred it at any time.",
  { text: z.string().max(2000).describe("A short, self-contained, third-person fact or finding to store, e.g. 'The user prefers aisle seats on flights over 3 hours.'") },
  async ({ text }) => {
    const r = await handoff.remember(text);
    if (!r.allowed) {
      return { content: [{ type: "text", text: `Write denied (${r.reason}). The user controls this on-chain — ask them to grant access.` }] };
    }
    return { content: [{ type: "text", text: `Saved to the user's "${r.namespace}" memory (id ${r.memId}). The user can see it was written by you, and can shred it anytime.` }] };
  },
);

server.tool(
  "memory_access",
  "Describe which slice of the user's memory you can access, and until when. Call this to understand your scope before using recall_memory.",
  {},
  async () => {
    const t = await handoff.terms();
    if (!t) return { content: [{ type: "text", text: "No valid Handoff grant is configured." }] };
    return {
      content: [{
        type: "text",
        text: `You are "${t.granteeLabel}" with read & write access to the user's "${t.namespace}" memory only. Status: ${t.status}. Expires: ${new Date(t.expiresAt).toISOString()}.`,
      }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
