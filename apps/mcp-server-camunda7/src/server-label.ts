/**
 * The server's one name for machines: its MCP `serverInfo.name` (the slug
 * mcp-use derives from the title "Pulse", the client key the docs suggest)
 * and the prefix of every line this app logs (`[pulse] …`). The app and its
 * composition both read it here, so the log never signs
 * one boot two ways. No imports: every module of the root may use it.
 */
export const SERVER_LABEL = "pulse"
