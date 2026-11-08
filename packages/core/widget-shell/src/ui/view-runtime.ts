/**
 * One official `App` per view document: the connection, the rendering call's lifecycle, the host
 * context and the model-context tree, as stores `useSyncExternalStore` reads. No React in here, so
 * the adapter (`ext-apps-host.tsx`) stays thin and the runtime tests without a React root.
 */
import { App, PostMessageTransport, type McpUiHostContext } from "@modelcontextprotocol/ext-apps"
import { ToolResultError, type ToolResult } from "../protocol/tool-result.js"

/** Accepted by `App.connect`; a test hands an in-memory one. */
export type ViewTransport = NonNullable<Parameters<App["connect"]>[0]>

interface ToolSnapshot {
  status: "pending" | "ready" | "error"
  toolOutput: unknown
  /** The latest input, a partial stream included. */
  toolInput: Record<string, unknown> | undefined
  /** The COMPLETE input of the call, what a re-run sends. */
  completeArgs: Record<string, unknown> | undefined
  /** The result arrived without `structuredContent` (a host strips it): re-run, don't wait. */
  stripped: boolean
  cancelled: boolean
  error: Error | undefined
}

interface HostSnapshot {
  hostContext: McpUiHostContext | undefined
  connected: boolean
  displayMode: string
  availableDisplayModes: readonly string[]
}

const NO_TOOL_CALL: ToolSnapshot = {
  status: "pending",
  toolOutput: undefined,
  toolInput: undefined,
  completeArgs: undefined,
  stripped: false,
  cancelled: false,
  error: undefined,
}

const displayModeOf = (context: McpUiHostContext | undefined): string =>
  context?.displayMode === "fullscreen" || context?.displayMode === "pip"
    ? context.displayMode
    : "inline"

/** The view's modes the host also offers; a host that names none offers inline. */
function negotiatedModes(
  viewModes: readonly string[],
  context: McpUiHostContext | undefined,
): readonly string[] {
  const hostModes: readonly string[] | undefined = context?.availableDisplayModes
  return hostModes === undefined ? ["inline"] : viewModes.filter((mode) => hostModes.includes(mode))
}

function sameModes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((mode, index) => mode === b[index])
}

function channel() {
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: () => {
      for (const listener of [...listeners]) listener()
    },
  }
}

interface ModelContextNode {
  id: string
  parentId: string | null
  content: string
  order: number
}

/** The tree as an indented markdown list, the same `_uiContext` text a view always reported. */
function describeTree(nodes: Iterable<ModelContextNode>): string {
  const byParent = new Map<string | null, ModelContextNode[]>()
  for (const node of nodes) {
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node])
  }
  const lines: string[] = []
  const walk = (parentId: string | null, depth: number) => {
    const children = [...(byParent.get(parentId) ?? [])].sort((a, b) => a.order - b.order)
    for (const child of children) {
      lines.push(`${"  ".repeat(depth)}- ${child.content.trim()}`)
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  return lines.join("\n")
}

/** ChatGPT's own channel for what a widget tells the model, where the host exposes it. */
interface WidgetStateApi {
  widgetState?: Record<string, unknown> | null
  setWidgetState(state: Record<string, unknown>): void | Promise<void>
}

const widgetStateApi = (): WidgetStateApi | undefined => {
  const api = (window as unknown as { openai?: WidgetStateApi }).openai
  return typeof api?.setWidgetState === "function" ? api : undefined
}

export interface ViewRuntime {
  connect: () => Promise<App>
  subscribeTool: (listener: () => void) => () => void
  getTool: () => ToolSnapshot
  subscribeHost: (listener: () => void) => () => void
  getHost: () => HostSnapshot
  /** RESOLVES with the raw result, an `isError` one included; rejects on a transport failure. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
  sendFollowUp: (prompt: string) => Promise<void>
  openLink: (url: string) => Promise<void>
  requestDisplayMode: (mode: "inline" | "fullscreen") => Promise<void>
  setModelContextNode: (node: Omit<ModelContextNode, "order">) => void
  removeModelContextNode: (id: string) => void
  dispose: () => Promise<void>
}

export function createViewRuntime(
  config: { displayModes: readonly string[] },
  options: { transport?: ViewTransport } = {},
): ViewRuntime {
  let tool = NO_TOOL_CALL
  let host: HostSnapshot = {
    hostContext: undefined,
    connected: false,
    displayMode: "inline",
    availableDisplayModes: ["inline"],
  }
  let disposed = false
  let connecting: Promise<App> | undefined
  const toolChannel = channel()
  const hostChannel = channel()

  const patchTool = (patch: Partial<ToolSnapshot>) => {
    tool = { ...tool, ...patch }
    toolChannel.emit()
  }
  const applyHostContext = (hostContext: McpUiHostContext | undefined, connected: boolean) => {
    const available = negotiatedModes(config.displayModes, hostContext)
    host = {
      hostContext,
      connected,
      displayMode: displayModeOf(hostContext),
      availableDisplayModes: sameModes(available, host.availableDisplayModes)
        ? host.availableDisplayModes
        : available,
    }
    hostChannel.emit()
  }

  const app = new App(
    { name: "pulse-view", version: "1.0.0" },
    { availableDisplayModes: [...config.displayModes] as ("inline" | "fullscreen" | "pip")[] },
    { autoResize: true },
  )
  // No correlation in these notifications: while pending they belong to the rendering call, and a
  // settled call ignores every later one.
  app.ontoolinput = ({ arguments: args }) => {
    if (tool.status !== "pending") return
    patchTool({ toolInput: args ?? {}, completeArgs: args ?? {} })
  }
  app.ontoolinputpartial = ({ arguments: args }) => {
    if (tool.status === "pending") patchTool({ toolInput: args ?? {} })
  }
  app.ontoolresult = (result) => {
    if (tool.status !== "pending") return
    if (result.isError === true) {
      patchTool({ status: "error", error: new ToolResultError(result) })
    } else if (result.structuredContent === undefined) {
      patchTool({ stripped: true })
    } else {
      patchTool({ status: "ready", toolOutput: result.structuredContent })
    }
  }
  app.ontoolcancelled = ({ reason }) => {
    if (tool.status !== "pending") return
    const message = reason ? `Tool call was cancelled: ${reason}` : "Tool call was cancelled."
    patchTool({ status: "error", cancelled: true, error: new Error(message) })
  }
  app.onhostcontextchanged = (params) => {
    if (!disposed) applyHostContext({ ...host.hostContext, ...params }, host.connected)
  }

  const connect = (): Promise<App> => {
    connecting ??= app
      .connect(options.transport ?? new PostMessageTransport(window.parent, window.parent))
      .then(() => {
        applyHostContext(app.getHostContext(), true)
        return app
      })
    return connecting
  }

  const requireCapability = async (
    name: "serverTools" | "message" | "openLinks",
    what: string,
  ): Promise<App> => {
    const connected = await connect()
    if (connected.getHostCapabilities()?.[name] === undefined) {
      throw new Error(`Host does not advertise the ${name} capability required to ${what}`)
    }
    return connected
  }

  // The model context: one full replacement per microtask, one request in flight.
  const nodes = new Map<string, ModelContextNode>()
  let order = 0
  let flushScheduled = false
  let sending = false
  let acknowledged: string | undefined
  let warned = false

  const publish = async (description: string): Promise<void> => {
    const structuredContent = { _uiContext: description }
    const chatGpt = widgetStateApi()
    if (chatGpt) {
      await chatGpt.setWidgetState({
        privateContent: {},
        ...chatGpt.widgetState,
        modelContent: structuredContent,
      })
      return
    }
    const connected = await connect()
    if (connected.getHostCapabilities()?.updateModelContext === undefined) {
      if (!warned) {
        warned = true
        console.warn("[pulse] The host does not take model context; updates are not sent.")
      }
      return
    }
    await connected.updateModelContext({
      structuredContent,
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    })
  }
  const flush = async (): Promise<void> => {
    if (sending || disposed) return
    const description = describeTree(nodes.values())
    if (description === acknowledged) return
    sending = true
    try {
      await publish(description)
      acknowledged = description
    } catch (error) {
      // Stays dirty: the next change retries the whole tree.
      console.warn("[pulse] updateModelContext failed:", error)
      sending = false
      return
    }
    sending = false
    if (describeTree(nodes.values()) !== description) void flush()
  }
  const schedule = () => {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(() => {
      flushScheduled = false
      void flush()
    })
  }

  return {
    connect,
    subscribeTool: toolChannel.subscribe,
    getTool: () => tool,
    subscribeHost: hostChannel.subscribe,
    getHost: () => host,
    callTool: async (name, args) => {
      const connected = await requireCapability("serverTools", "call server tools")
      return await connected.callServerTool({ name, arguments: args })
    },
    sendFollowUp: async (prompt) => {
      const connected = await requireCapability("message", "send follow-up messages")
      await connected.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] })
    },
    openLink: async (url) => {
      const connected = await requireCapability("openLinks", "open external links")
      await connected.openLink({ url })
    },
    requestDisplayMode: async (mode) => {
      const connected = await connect()
      const offered = negotiatedModes(config.displayModes, connected.getHostContext())
      if (!offered.includes(mode)) {
        throw new Error(`Display mode "${mode}" is not among [${offered.join(", ")}]`)
      }
      await connected.requestDisplayMode({ mode })
    },
    setModelContextNode: (node) => {
      const previous = nodes.get(node.id)
      nodes.set(node.id, { ...node, order: previous?.order ?? order++ })
      schedule()
    },
    removeModelContextNode: (id) => {
      if (nodes.delete(id)) schedule()
    },
    dispose: async () => {
      disposed = true
      await app.close().catch(() => undefined)
    },
  }
}
