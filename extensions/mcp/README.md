# MCP bridge extension

pi has no built-in MCP support. This extension reads `mcp.json`, launches each
configured MCP server over stdio, and registers its tools into pi as native tools
named `mcp_<server>_<tool>`.

## Configuring servers

Edit `mcp.json` (Claude-Desktop-style `mcpServers` map):

```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@some/gmail-mcp-server"],
      "env": { "GMAIL_CREDS": "/app/secrets/gmail-token.json" }
    }
  }
}
```

Fields per server: `command`, `args` (optional), `env` (optional, merged over the
process env), `disabled` (optional, set `true` to skip without deleting).

## Install / update deps

`node_modules` is git-ignored. After a fresh clone or dependency change:

```bash
docker compose exec core sh -c 'cd /app/.pi/extensions/mcp && npm install'
```

## Smoke test

Temporarily add the reference test server and ask the model to use it:

```json
{ "mcpServers": { "everything": {
    "command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything", "stdio"] } } }
```
```bash
docker exec core_harness pi -p "Use the available MCP tool to add 17 and 25." --model local/local-model
```
Expect `42`. Remove the entry afterward (it adds startup latency on every run).

## Notes

- The extension's async factory blocks pi startup until servers connect (bounded by a
  20s per-server timeout), then closes all clients on `session_shutdown`.
- stdio MCP servers run as child processes inside the `core` container, so their
  binaries/creds must be reachable there (creds via the `/app/secrets` mount).
