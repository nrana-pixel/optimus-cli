/**
 * MCP Service — Model Context Protocol integration
 *
 * Connects Optimus to external MCP servers (web search, databases, APIs, etc.)
 * Each MCP server exposes tools that the LLM can call via the text-based tool format.
 *
 * Config is stored in ~/.multi-agent/mcp-servers.json
 *
 * Supports:
 *   - stdio transport (spawn a local process)
 *   - Config-file-based server management
 *   - Auto-discovery of tools per server
 *   - Calling MCP tools and returning results
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  /** Unique name for this server (e.g. "web-search", "github") */
  name: string;
  /** Command to spawn the MCP server process */
  command: string;
  /** Arguments to pass to the command */
  args: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
  /** Whether to enable this server */
  enabled: boolean;
}

export interface MCPTool {
  /** Which MCP server this tool belongs to */
  serverName: string;
  /** Tool name as exposed by the MCP server */
  name: string;
  /** Tool description */
  description: string;
  /** JSON schema for the input parameters */
  inputSchema: Record<string, any>;
}

export interface MCPToolCallResult {
  serverName: string;
  toolName: string;
  content: string;
  isError: boolean;
}

// ─── MCPService ─────────────────────────────────────────────────────────────

export class MCPService {
  private static readonly CONFIG_DIR  = join(homedir(), '.multi-agent');
  private static readonly CONFIG_FILE = join(MCPService.CONFIG_DIR, 'mcp-servers.json');

  /** Active MCP client connections (keyed by server name) */
  private clients: Map<string, Client> = new Map();
  /** Active transports (for cleanup) */
  private transports: Map<string, StdioClientTransport> = new Map();
  /** Discovered tools from all connected servers */
  private tools: MCPTool[] = [];

  // ─── Config file management ──────────────────────────────────────────────

  static loadConfig(): MCPServerConfig[] {
    if (!existsSync(MCPService.CONFIG_FILE)) return [];
    try {
      return JSON.parse(readFileSync(MCPService.CONFIG_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }

  static saveConfig(configs: MCPServerConfig[]): void {
    if (!existsSync(MCPService.CONFIG_DIR)) {
      mkdirSync(MCPService.CONFIG_DIR, { recursive: true });
    }
    writeFileSync(MCPService.CONFIG_FILE, JSON.stringify(configs, null, 2));
  }

  static addServer(config: MCPServerConfig): void {
    const configs = MCPService.loadConfig();
    // Replace if exists
    const idx = configs.findIndex(c => c.name === config.name);
    if (idx >= 0) configs[idx] = config;
    else configs.push(config);
    MCPService.saveConfig(configs);
  }

  static removeServer(name: string): boolean {
    const configs = MCPService.loadConfig();
    const filtered = configs.filter(c => c.name !== name);
    if (filtered.length === configs.length) return false;
    MCPService.saveConfig(filtered);
    return true;
  }

  // ─── Connection management ───────────────────────────────────────────────

  /** Connect to all enabled MCP servers from config */
  async connectAll(): Promise<{ connected: string[]; failed: Array<{ name: string; error: string }> }> {
    const configs = MCPService.loadConfig().filter(c => c.enabled);
    const connected: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const cfg of configs) {
      try {
        await this.connectToServer(cfg);
        connected.push(cfg.name);
      } catch (err: any) {
        failed.push({ name: cfg.name, error: err.message });
      }
    }

    return { connected, failed };
  }

  /** Connect to a single MCP server */
  async connectToServer(config: MCPServerConfig): Promise<string[]> {
    // If already connected, disconnect first
    if (this.clients.has(config.name)) {
      await this.disconnectServer(config.name);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    });

    const client = new Client(
      { name: 'optimus-cli', version: '1.0.0' },
      { capabilities: {} }
    );

    // Connect with a timeout to prevent hanging on unresponsive servers
    const CONNECT_TIMEOUT_MS = 15_000;
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP server '${config.name}' connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s`)), CONNECT_TIMEOUT_MS)
      ),
    ]);

    // Discover tools
    const result = await client.listTools();
    const serverTools: MCPTool[] = result.tools.map(tool => ({
      serverName: config.name,
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema as Record<string, any>,
    }));

    this.clients.set(config.name, client);
    this.transports.set(config.name, transport);

    // Merge tools (remove old ones from this server, add new)
    this.tools = this.tools.filter(t => t.serverName !== config.name);
    this.tools.push(...serverTools);

    return serverTools.map(t => t.name);
  }

  /** Disconnect a specific server */
  async disconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
      this.clients.delete(name);
    }
    const transport = this.transports.get(name);
    if (transport) {
      try { await transport.close(); } catch { /* ignore */ }
      this.transports.delete(name);
    }
    this.tools = this.tools.filter(t => t.serverName !== name);
  }

  /** Disconnect all servers */
  async disconnectAll(): Promise<void> {
    for (const name of [...this.clients.keys()]) {
      await this.disconnectServer(name);
    }
  }

  // ─── Tool calling ───────────────────────────────────────────────────────

  /** Get all discovered tools */
  getTools(): MCPTool[] {
    return this.tools;
  }

  /** Get count of connected servers */
  getConnectedCount(): number {
    return this.clients.size;
  }

  /** Check if a tool name belongs to an MCP server */
  isMCPTool(toolName: string): boolean {
    return this.tools.some(t => t.name === toolName);
  }

  /** Call an MCP tool by name */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      return {
        serverName: 'unknown',
        toolName,
        content: `MCP tool "${toolName}" not found. Available: ${this.tools.map(t => t.name).join(', ')}`,
        isError: true,
      };
    }

    const client = this.clients.get(tool.serverName);
    if (!client) {
      return {
        serverName: tool.serverName,
        toolName,
        content: `MCP server "${tool.serverName}" is not connected`,
        isError: true,
      };
    }

    try {
      const result = await client.callTool({ name: toolName, arguments: args });

      // MCP results can be an array of content items
      let content = '';
      if (Array.isArray(result.content)) {
        content = result.content
          .map((c: any) => {
            if (c.type === 'text') return c.text;
            if (c.type === 'image') return `[image: ${c.mimeType}]`;
            return JSON.stringify(c);
          })
          .join('\n');
      } else if (typeof result.content === 'string') {
        content = result.content;
      } else {
        content = JSON.stringify(result.content);
      }

      return {
        serverName: tool.serverName,
        toolName,
        content,
        isError: !!result.isError,
      };
    } catch (err: any) {
      return {
        serverName: tool.serverName,
        toolName,
        content: `MCP call failed: ${err.message}`,
        isError: true,
      };
    }
  }

  // ─── LLM system prompt integration ──────────────────────────────────────

  /**
   * Return native OpenAI-compatible tool definitions for MCP servers.
   */
  getNativeTools(): any[] {
    return this.tools.map(tool => {
      // Create a clean JSON schema for parameters
      let parameters = tool.inputSchema || { type: 'object', properties: {} };
      if (!parameters.type) parameters.type = 'object';
      
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: (tool.description || '') + ` [Server: ${tool.serverName}]`,
          parameters
        }
      };
    });
  }

  /**
   * Generate a system prompt section listing all MCP tools.
   * This is appended to the main tools system prompt.
   */
  mcpToolsSection(): string {
    if (this.tools.length === 0) return '';
    return '\n## MCP Tools Available:\n' + this.tools.map(t => `- ${t.name} (from ${t.serverName}): ${t.description}`).join('\n') + '\nCall these using native tool calls.\n';
  }

  // ─── Pre-configured popular servers ────────────────────────────────────

  /** Get a list of well-known MCP server configs that users can quickly add */
  static getPopularServers(): Array<MCPServerConfig & { description: string }> {
    return [
      {
        name: 'filesystem',
        description: 'Read/write files, search directories, get file info',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        enabled: true,
      },
      {
        name: 'github',
        description: 'GitHub repo management, issues, PRs, code search',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
        enabled: true,
      },
      {
        name: 'memory',
        description: 'Persistent knowledge graph memory',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        enabled: true,
      },
      {
        name: 'sqlite',
        description: 'Execute SQL queries against a local SQLite database',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite', 'database.db'],
        enabled: true,
      },
      {
        name: 'postgres',
        description: 'PostgreSQL database access',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
        enabled: true,
      },
    ];
  }
}
