import { createContext, createElement, useContext, type ComponentType, type ReactNode } from "react"
import { ViewErrorBoundary } from "./view-error-boundary.js"

/**
 * Another module's widget, rendered by a raw id without a module-to-module import: it takes its
 * scope as props and fetches its own data. Only cross-module surfaces use it: each module's
 * `<module>:settings` section on the settings page, and `analytics:engine-landscape` in the fleet.
 */
export type HostWidget = ComponentType<Record<string, unknown>>
export type HostWidgets = Readonly<Record<string, HostWidget>>

const NO_WIDGETS: HostWidgets = {}

const HostWidgetsContext = createContext<HostWidgets>(NO_WIDGETS)

export function HostWidgetsProvider({
  widgets,
  children,
}: {
  widgets: HostWidgets
  children: ReactNode
}) {
  return <HostWidgetsContext.Provider value={widgets}>{children}</HostWidgetsContext.Provider>
}

export function useHostWidgets(): HostWidgets {
  return useContext(HostWidgetsContext)
}

/** `undefined` when the module is not in this bundle: the caller renders nothing. */
export function useHostWidget(id: string): HostWidget | undefined {
  const widgets = useHostWidgets()
  return Object.hasOwn(widgets, id) ? widgets[id] : undefined
}

/**
 * Renders the host widget `id` with `props`, or nothing when the module is not in this bundle.
 * A slot, so no component is picked during render (react-hooks/static-components). The widget is
 * another module's code, so its crash stays inside the slot's own error boundary.
 */
export function HostWidgetSlot({
  id,
  props = {},
}: {
  id: string
  props?: Record<string, unknown>
}) {
  const widget = useHostWidget(id)
  return widget ? <ViewErrorBoundary>{createElement(widget, props)}</ViewErrorBoundary> : null
}

const SETTINGS_SECTION_SUFFIX = ":settings"

/**
 * The settings page's extension point: every `<module>:settings` entry, in registration order. A
 * module adds its section to the host widgets and needs no other edit.
 */
export function settingsSections(
  widgets: HostWidgets,
): ReadonlyArray<readonly [string, HostWidget]> {
  return Object.entries(widgets).filter(([id]) => id.endsWith(SETTINGS_SECTION_SUFFIX))
}
