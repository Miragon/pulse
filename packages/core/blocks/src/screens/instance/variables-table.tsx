import type { VariableRowData } from "@miragon/pulse-screens"
import type { ReactNode } from "react"
import { useInstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"
import { NoValue } from "./instance-time.js"
import { VariableValue } from "./variable-value.js"

/**
 * A surface's editor of a variable's value (a write slot: the editors that write fill it), over its
 * own rows, which carry what it needs beside the screen's.
 */
export interface VariableEditorSlot<Row extends VariableRowData> {
  /** The editor in a row's value cell while the row is edited, else `undefined`. */
  readonly editing: (row: Row) => ReactNode
  /** The controls at the end of a row's value (its edit button), or nothing. */
  readonly controls: (row: Row) => ReactNode
  /** What the surface says beside a row's name (that a change does not reach a scope), or nothing. */
  readonly note: (row: Row) => ReactNode
}

export interface VariablesTableProps<Row extends VariableRowData> {
  /** The instance's variables (`InstanceScreenData.variables`, or a surface's rows over them). */
  readonly variables: readonly Row[]
  /** An element's name, as the surface knows it: a variable's scope. */
  readonly nameOf: (elementId: string) => string
  /** The surface's editor; without it the table only reads. */
  readonly editor?: VariableEditorSlot<Row>
  readonly slots: Pick<InstanceSlots, "PlainTable" | "onCopy">
}

/**
 * An instance's variables in the surface's table: the name, the engine's type, the value (to open
 * and copy) and the scope, the process or an element. It only reads: an editor is the surface's
 * slot. Its rows open nothing.
 */
export function VariablesTable<Row extends VariableRowData>({
  variables,
  nameOf,
  editor,
  slots,
}: VariablesTableProps<Row>) {
  const t = useInstanceWords()
  const { PlainTable, onCopy } = slots
  return (
    <PlainTable<Row>
      name="variables"
      label={t("variables.label")}
      columns={[
        {
          key: "name",
          label: t("variables.name"),
          cell: (row) => (
            <span className="inline-flex items-center gap-1.5" data-part="variable-name">
              <code className="font-mono">{row.name}</code>
              {editor?.note(row)}
            </span>
          ),
        },
        { key: "type", label: t("variables.type"), cell: (row) => row.type ?? <NoValue /> },
        {
          key: "value",
          label: t("variables.value"),
          cell: (row) =>
            editor?.editing(row) ?? (
              <VariableValue row={row} controls={editor?.controls(row)} onCopy={onCopy} />
            ),
        },
        {
          key: "scope",
          label: t("variables.scope"),
          cell: (row) =>
            row.scopeElementId === undefined ? t("variables.process") : nameOf(row.scopeElementId),
        },
      ]}
      rows={variables}
      rowKey={(row) => `${row.scopeElementId ?? ""}:${row.name}`}
      empty={t("variables.empty")}
    />
  )
}
