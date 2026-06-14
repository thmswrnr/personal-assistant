/**
 * MCP bridge for pi.
 *
 * Reads mcp.json, launches each configured MCP server over stdio, lists its
 * tools, and registers them into pi as native tools named
 * `mcp_<server>_<tool>` that proxy calls through the MCP SDK.
 *
 * pi has no built-in MCP; this extension is how MCP servers (Gmail, etc.) plug
 * in. Config format mirrors the common "mcpServers" convention.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";

// Config lives next to this extension (tracked in the repo). Overridable for tests.
const CONFIG_PATH = process.env.PI_MCP_CONFIG ?? "/app/.pi/extensions/mcp/mcp.json";
// Don't let a slow/dead server hang pi startup forever (the factory blocks startup).
const CONNECT_TIMEOUT_MS = 20_000;

interface ServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}
interface Config {
  mcpServers?: Record<string, ServerSpec>;
}

function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
  } catch (err) {
    console.error(`[mcp-bridge] could not read ${CONFIG_PATH}:`, err);
    return {};
  }
}

const sanitize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_]/g, "_");

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export default async function mcpBridge(pi: ExtensionAPI) {
  const cfg = loadConfig();
  const servers = Object.entries(cfg.mcpServers ?? {}).filter(([, s]) => !s.disabled);

  if (servers.length === 0) {
    console.error("[mcp-bridge] no enabled MCP servers in mcp.json — nothing to do");
    return;
  }

  const clients: Client[] = [];

  for (const [serverName, spec] of servers) {
    const client = new Client({ name: "pi-mcp-bridge", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(spec.env ?? {}) },
    });

    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `connect(${serverName})`);
    } catch (err) {
      console.error(`[mcp-bridge] ${serverName}: connect failed, skipping:`, err);
      try { await client.close(); } catch { /* ignore */ }
      continue;
    }
    clients.push(client);

    let tools;
    try {
      ({ tools } = await client.listTools());
    } catch (err) {
      console.error(`[mcp-bridge] ${serverName}: listTools failed:`, err);
      continue;
    }

    for (const tool of tools) {
      const piName = `mcp_${sanitize(serverName)}_${sanitize(tool.name)}`;
      const mcpName = tool.name;
      pi.registerTool({
        name: piName,
        label: `MCP ${serverName}: ${mcpName}`,
        description: tool.description ?? `MCP tool ${mcpName} from ${serverName}`,
        promptSnippet: `MCP ${serverName} tool ${mcpName}`,
        // MCP inputSchema is already JSON Schema; hand it to pi directly.
        parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as any,
        async execute(_toolCallId, params) {
          const res: any = await client.callTool({
            name: mcpName,
            arguments: (params ?? {}) as Record<string, unknown>,
          });
          const text = (res?.content ?? [])
            .map((c: any) => (c?.type === "text" ? c.text : JSON.stringify(c)))
            .join("\n");
          return {
            content: [{ type: "text", text: text || "(no content)" }],
            details: { server: serverName, mcpTool: mcpName, isError: !!res?.isError },
          };
        },
      });
    }
    console.error(`[mcp-bridge] ${serverName}: registered ${tools.length} tool(s)`);
  }

  // Close all MCP clients (and their child processes) on session end so pi exits cleanly.
  pi.on("session_shutdown", async () => {
    for (const c of clients) {
      try { await c.close(); } catch { /* ignore */ }
    }
  });
}
