import { createContext, useContext, type ReactNode } from "react"
import type { WidgetComponent } from "@miragon/mcp-toolkit-ui/app"

/**
 * Lets composed views render OTHER modules' widgets by id without a
 * module-to-module import. Empty by default: unresolved cells are dropped.
 */
const HostWidgetsContext = createContext<Record<string, WidgetComponent>>({})

export function HostWidgetsProvider({
  widgets,
  children,
}: {
  widgets: Record<string, WidgetComponent>
  children: ReactNode
}) {
  return <HostWidgetsContext.Provider value={widgets}>{children}</HostWidgetsContext.Provider>
}

export function useHostWidgets(): Record<string, WidgetComponent> {
  return useContext(HostWidgetsContext)
}
