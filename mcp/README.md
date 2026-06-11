# @handoff/mcp

An [MCP](https://modelcontextprotocol.io) server that lets any MCP-capable agent — **Claude Desktop, Cursor, Windsurf, Claude Code** — consume a **Handoff grant**.

The agent gets three tools backed by a single grant. It can read — and save findings into — the **one** memory slice the user granted (scoped, expiring, revocable, audited on-chain) and nothing else.

## Tools
- `recall_memory(query)` — pull scoped memory just-in-time through the gateway.
- `remember_memory(text)` — save a durable finding into the granted slice (provenance-tagged; the user can shred it with on-chain proof).
- `memory_access()` — describe the agent's scope and expiry.

## Configure (Claude Desktop example)

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "handoff": {
      "command": "node",
      "args": ["/absolute/path/to/handoff/mcp/src/server.mjs"],
      "env": {
        "HANDOFF_GRANT_ID": "0x…",
        "HANDOFF_CREDENTIAL_KEY": "…the key the user shared…",
        "HANDOFF_GATEWAY_URL": "https://your-gateway.example"
      }
    }
  }
}
```

Then ask the agent something like *"What are my dietary preferences?"* — it calls `recall_memory`, the gateway returns only the granted slice, and the moment the user revokes the grant the next call is denied.

## Install / run

```bash
pnpm install
pnpm start    # stdio MCP server
```
