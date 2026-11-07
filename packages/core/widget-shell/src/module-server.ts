import type { McpServer } from "@modelcontextprotocol/server"

/**
 * What a module's `register(server)` gets: the official SDK server's two registration methods,
 * with their exact signatures, so a module registers the way the SDK's docs show and
 * `registerAppTool` from `@modelcontextprotocol/ext-apps/server` takes it as its server. The boot
 * records every registration once and replays it into each request's own `McpServer`
 * (`tool-registration.ts`); resources are the boot's: it serves one view per view-bound tool.
 */
export type ModuleServer = Pick<McpServer, "registerTool" | "registerPrompt">
