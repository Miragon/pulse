import http from "node:http"
import type { ComposableModule, ModulePlugin } from "./composition.js"
import type { ModuleServer } from "./module-server.js"

export const answer = () => ({
  content: [{ type: "text" as const, text: "ok" }],
  structuredContent: {},
})

/** A plain tool without input: the boot makes it strict, `strictToolInput({})`. */
export const plain = (server: ModuleServer, name: string, config: { description?: string } = {}) =>
  server.registerTool(name, config, answer)

/** A module without toolsets around one plugin: the boot builds it like any other. */
export const moduleOf = (plugin: ModulePlugin): ComposableModule<object> => ({
  name: plugin.name,
  configFromEnv: () => ({}),
  knownEnvVars: [],
  createPlugin: () => plugin,
})

export const pluginOf = (name: string, ...toolNames: string[]): ModulePlugin => ({
  name,
  register: (server) => {
    for (const toolName of toolNames) plain(server, toolName)
  },
})

export const withPlugins = (...plugins: ModulePlugin[]) => ({ modules: plugins.map(moduleOf) })

/** One JSON-RPC call on a fresh connection; the server is stateless, so no initialize first. */
export function rpc(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/mcp",
        agent: false,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8")
          const json = body.trimStart().startsWith("{")
            ? body
            : body
                .split("\n")
                .find((line) => line.startsWith("data: "))!
                .slice("data: ".length)
          resolve((JSON.parse(json) as { result: Record<string, unknown> }).result)
        })
      },
    )
    req.on("error", reject)
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }))
  })
}
