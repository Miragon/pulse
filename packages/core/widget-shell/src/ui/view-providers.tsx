import { useState, type ReactNode } from "react"
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import { ToastProvider, ICON_STROKE } from "@miragon/pulse-ui"
import { LucideProvider } from "lucide-react"
import { HostDocument } from "./host-document.js"
import { LocaleGate } from "./locale-gate.js"
import { createViewQueryClient } from "./tool-query.js"

/**
 * Everything below a root's host adapter, the same under every host (`ViewRoot` in a chat,
 * `PageRoot` on a page). The order is load-bearing: the host above it first (every hook below
 * reads it), ONE query client per document, the document layer (theme, fonts, the inline budget
 * box), the gate that resolves the locale from the host, then the kit's icon stroke and toasts.
 * The query client is the root's where it hands one in (a page's `mountApp`), else the view's.
 */
export function ViewProviders({
  children,
  client: given,
}: {
  children: ReactNode
  client?: QueryClient
}) {
  const [client] = useState(() => given ?? createViewQueryClient())
  return (
    <QueryClientProvider client={client}>
      <HostDocument>
        <LocaleGate>
          <LucideProvider strokeWidth={ICON_STROKE}>
            <ToastProvider>{children}</ToastProvider>
          </LucideProvider>
        </LocaleGate>
      </HostDocument>
    </QueryClientProvider>
  )
}

/** The document's `#root`, created where the document has none. */
export function rootElement(): HTMLElement {
  const existing = document.getElementById("root")
  if (existing) return existing
  const container = document.createElement("div")
  container.id = "root"
  document.body.appendChild(container)
  return container
}
