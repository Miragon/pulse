const KIT_SLOTS = {
  "context-bar": ['[data-slot="view-bar"]'],
  "context-subject": ['[data-slot="view-bar-subject"]'],
  access: ['[data-slot="view-bar-access"]'],
  freshness: ['[data-slot="view-bar-freshness"]'],
  "status-strip": ['[data-slot="status-strip"]'],
  "strip-title": ['[data-slot="status-strip"] p > span:first-child'],
  "state-label": ['[data-slot="state-label"]'],
  "segment-count": ['[data-slot="segmented-option"] > span:last-child'],
  "tab-bar": ['[data-slot="tabs-list"]'],
  "filter-chip": ['[data-slot="condition-chip"]'],
  "filter-summary": ['[data-slot="toolbar-summary"]'],
  skeleton: ['[data-slot="skeleton"]', '[data-slot="data-table-skeleton"]'],
  "data-table": ['[data-slot="data-table"]'],
}

export function part(name, state = {}) {
  const extra = Object.entries(state)
    .map(([key, value]) => `[data-${key}="${value}"]`)
    .join("")
  const own = `[data-part="${name}"]`
  const hooks = [own, ...(KIT_SLOTS[name] ?? []).map((slot) => `${slot}:not(${own} *)`)]
  return hooks.length === 1 ? `${hooks.join("")}${extra}` : `:is(${hooks.join(", ")})${extra}`
}
