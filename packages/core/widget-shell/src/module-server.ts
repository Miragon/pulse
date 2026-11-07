import type { McpServer } from "@modelcontextprotocol/server"

/**
 * What a module's `register(server)` gets: the official SDK server's three registration methods,
 * with their exact signatures, so a module registers the way the SDK's docs show and
 * `registerAppTool` and `registerAppResource` from `@modelcontextprotocol/ext-apps/server` take it
 * as their server. The boot records every registration once and replays it into each request's
 * own `McpServer` (`tool-registration.ts`). A view from the host bundle needs no resource: the boot
 * serves it. `registerResource` is for what a module brings itself: a finished HTML view or data.
 */
export type ModuleServer = Pick<McpServer, "registerTool" | "registerPrompt" | "registerResource">
