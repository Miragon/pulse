import { normalizeLayout, type LayoutConfig, type RowDef } from "@miragon/mcp-toolkit-core"
import { SHELL_SETTINGS_WIDGET } from "../shell-settings-contract.js"

const SETTINGS_SECTION_SUFFIX = ":settings"

/**
 * The host-extension point of the settings page: a module catalogues
 * `<module>:settings` and needs no other edit. Ids stay raw strings (tier 2);
 * an inactive module's section hides itself once its feed answers "unknown tool".
 */
export function settingsLayout(widgetIds: readonly string[] = []): LayoutConfig {
  const sections = widgetIds.filter(
    (id) => id !== SHELL_SETTINGS_WIDGET && id.endsWith(SETTINGS_SECTION_SUFFIX),
  )
  // Deduped: callers may merge several registries into the id list.
  return [SHELL_SETTINGS_WIDGET, ...new Set(sections)].map((widget) => ({
    row: [{ widget, props: {} }],
  }))
}

/** Tier-2 degradation: a missing module's section disappears instead of an unknown-widget error. */
export function filterLayoutToWidgets(
  layout: LayoutConfig,
  widgets: Record<string, unknown>,
): LayoutConfig {
  const filterRows = (rows: RowDef[]): RowDef[] =>
    rows
      .map((r) => ({ ...r, row: r.row.filter((cell) => cell.widget in widgets) }))
      .filter((r) => r.row.length > 0)
  const normalized = normalizeLayout(layout)
  return "tabs" in normalized
    ? { tabs: normalized.tabs.map((tab) => ({ ...tab, rows: filterRows(tab.rows) })) }
    : { rows: filterRows(normalized.rows) }
}
