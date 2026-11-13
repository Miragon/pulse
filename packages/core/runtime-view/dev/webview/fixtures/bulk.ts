import type { BulkView, DefinitionView, InstanceRow } from "../../../src/core/protocol/index.js"
import { DEFINITION_VIEW, INSTANCES } from "./definition.js"
import { LOCAL_ENGINE } from "./engines.js"

const SELECTED = new Set(["ORD-10442", "ORD-10438", "ORD-10431"])

function selectable(row: InstanceRow, selected: boolean): InstanceRow {
  return { ...row, selectable: true, ...(selected ? { selected: true } : {}) }
}

const WRITABLE_DEFINITION: DefinitionView = {
  ...DEFINITION_VIEW,
  engine: {
    ...LOCAL_ENGINE,
    access: {
      writable: true,
      note: "Pulse may retry incidents, change variables, move tokens, cancel and migrate instances on local.",
    },
  },
  notices: [],
  instances: INSTANCES.map((row) => selectable(row, false)),
}

export const SELECTING_DEFINITION: DefinitionView = {
  ...WRITABLE_DEFINITION,
  instances: INSTANCES.map((row) => selectable(row, SELECTED.has(row.businessKey ?? ""))),
  selection: {
    count: 3,
    eligible: "running",
    allMatching: false,
    matching: 12,
    cap: 1000,
    offers: [{ action: "cancelInstances", label: "Cancel instances…" }],
    migration: "Migrate to version…",
  },
}

const RUNNING_BULK: BulkView = {
  status: "running",
  notice: {
    tone: "info",
    title: "Cancelling instances: 5 of 12 done",
    actions: [{ kind: "stopBulk", label: "Stop" }],
  },
  progress: { total: 12, done: 5, failed: 0 },
  announcement: "Cancelling instances: 5 of 12 done",
}

export const BULK_RUNNING_DEFINITION: DefinitionView = {
  ...WRITABLE_DEFINITION,
  bulk: RUNNING_BULK,
}

export const BULK_STOPPED_DEFINITION: DefinitionView = {
  ...WRITABLE_DEFINITION,
  bulk: {
    status: "stopped",
    notice: {
      tone: "warning",
      title: "Stopped. 5 of 12 cancelled, 7 still running.",
      detail: "Stopping doesn't undo what is already done.",
      actions: [
        { kind: "selectRemaining", label: "Select the 7 still running" },
        { kind: "dismissBulk", label: "Dismiss" },
      ],
    },
    progress: { total: 12, done: 5, failed: 0 },
    announcement: "Stopped. 5 of 12 cancelled, 7 still running.",
  },
}
