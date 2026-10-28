import type { ReactNode } from "react"
import { McpUseHostBridgeProvider, type WidgetComponent } from "@miragon/mcp-toolkit-ui/app"
import { HostDocument } from "./host-document.js"
import { HostWidgetsProvider } from "./host-widgets.js"
import { ProfileGate } from "./profile-gate.js"
import { ViewHostBridge } from "./shell-host.js"

export interface AppShellProvidersProps {
  /** The host bundle map — also provided to composed views via HostWidgetsProvider. */
  widgets: Record<string, WidgetComponent>
  children: ReactNode
}

/** Order is load-bearing: the bridge reads mcp-use's view-scoped hooks, the document layer and the gate read the host context, the gate needs the bridge. Hosts compose their own layers inside. */
export function AppShellProviders({ widgets, children }: AppShellProvidersProps) {
  return (
    <ViewHostBridge>
      <HostDocument>
        <McpUseHostBridgeProvider>
          <ProfileGate>
            <HostWidgetsProvider widgets={widgets}>{children}</HostWidgetsProvider>
          </ProfileGate>
        </McpUseHostBridgeProvider>
      </HostDocument>
    </ViewHostBridge>
  )
}
