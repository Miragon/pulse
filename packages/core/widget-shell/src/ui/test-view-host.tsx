/**
 * Renders a widget WITHOUT a host: fake tools, a log of what it asked the host to do and the
 * model context it reported. It mounts the same host contexts as the ext-apps adapter
 * (`HostContexts`: display mode, fullscreen switch, inline budget, view host), a query client,
 * the host widgets, the icon stroke and toasts, so a widget test needs no host. Not
 * mounted: `HostDocument` (theme, fonts, the measured inline fit) and `LocaleGate` (pass
 * `locale` instead).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import { LocaleProvider, ToastProvider, ICON_STROKE } from "@miragon/pulse-ui"
import { LucideProvider } from "lucide-react"
import type { ToolResult } from "../protocol/tool-result.js"
import { HostContexts, type RequestDisplayMode } from "./host-contexts.js"
import { HostWidgetsProvider, type HostWidgets } from "./host-widgets.js"
import type { ShellHost } from "./shell-host.js"
import { createViewQueryClient } from "./tool-query.js"
import type { ViewHost } from "./view-host.js"

export type HostAction =
  | { type: "callTool"; name: string; args: Record<string, unknown> }
  | { type: "sendFollowUp"; prompt: string }
  | { type: "openExternal"; url: string }
  | { type: "requestDisplayMode"; mode: string }

export interface TestViewHostProps {
  /**
   * Fake tools by name. A function gets the args (may be async; a throw or reject is a transport
   * failure); a value with `structuredContent`/`content`/`isError` is returned as it is; any other
   * value is wrapped as `{ structuredContent: v, content: [{ type: "text", text }] }`. A missing
   * tool rejects with `[TestViewHost] no fake for tool "<name>"`.
   */
  tools?: Readonly<Record<string, unknown>>
  /** Every tool call, follow-up, link and display-mode request, in order. */
  onHostAction?: (action: HostAction) => void
  /** Each mounted `HostModelContext` reports its content (last writer wins). */
  onModelContext?: (text: string) => void
  /** Merged over `{ connected: true, displayMode: "inline", availableDisplayModes: [] }`. */
  host?: Partial<ShellHost>
  hostWidgets?: HostWidgets
  /** Default: `createTestQueryClient()`, once per mount. */
  client?: QueryClient
  /** Wraps a `LocaleProvider` only when given, so an outer one wins. */
  locale?: string
  children: ReactNode
}

/** The view's defaults without retries, so a failing fake fails at once. */
export function createTestQueryClient(): QueryClient {
  const client = createViewQueryClient()
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retry: false },
    mutations: { retry: false },
  })
  return client
}

function isResult(value: unknown): value is ToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    ("structuredContent" in value || "content" in value || "isError" in value)
  )
}

function toResult(value: unknown): ToolResult {
  if (isResult(value)) return value
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return { structuredContent: value, content: [{ type: "text", text: text ?? "" }] }
}

const NO_HOST: ShellHost = { connected: true, displayMode: "inline", availableDisplayModes: [] }
const NO_WIDGETS: HostWidgets = {}

type ModelContextSink = ((text: string) => void) | undefined

const ModelContextSinkContext = createContext<ModelContextSink>(undefined)

function FakeModelContext({ content, children }: { content: string; children?: ReactNode }) {
  const report = useContext(ModelContextSinkContext)
  useEffect(() => {
    report?.(content)
  }, [report, content])
  return children
}

function createFakeHost(
  tools: Readonly<Record<string, unknown>> = {},
  record: (action: HostAction) => void = () => undefined,
): ViewHost {
  return {
    callTool: async (name, args = {}) => {
      const callArgs = args as Record<string, unknown>
      record({ type: "callTool", name, args: callArgs })
      if (!Object.hasOwn(tools, name)) throw new Error(`[TestViewHost] no fake for tool "${name}"`)
      const fake = tools[name]
      const value: unknown =
        typeof fake === "function" ? await (fake as (a: unknown) => unknown)(callArgs) : fake
      return toResult(value)
    },
    sendFollowUp: (prompt) => record({ type: "sendFollowUp", prompt }),
    openExternal: (url) => record({ type: "openExternal", url }),
    ModelContext: FakeModelContext,
  }
}

export function TestViewHost({
  tools,
  onHostAction,
  onModelContext,
  host,
  hostWidgets,
  client,
  locale,
  children,
}: TestViewHostProps) {
  const fake = useMemo(() => createFakeHost(tools, onHostAction), [tools, onHostAction])
  const [ownClient] = useState(createTestQueryClient)
  const shell = useMemo<ShellHost>(() => ({ ...NO_HOST, ...host }), [host])
  const request = useCallback<RequestDisplayMode>(
    (mode) => onHostAction?.({ type: "requestDisplayMode", mode }),
    [onHostAction],
  )
  const tree = (
    <ModelContextSinkContext.Provider value={onModelContext}>
      <HostContexts shell={shell} host={fake} requestDisplayMode={request}>
        <QueryClientProvider client={client ?? ownClient}>
          <HostWidgetsProvider widgets={hostWidgets ?? NO_WIDGETS}>
            <LucideProvider strokeWidth={ICON_STROKE}>
              <ToastProvider>{children}</ToastProvider>
            </LucideProvider>
          </HostWidgetsProvider>
        </QueryClientProvider>
      </HostContexts>
    </ModelContextSinkContext.Provider>
  )
  return locale === undefined ? tree : <LocaleProvider locale={locale}>{tree}</LocaleProvider>
}
