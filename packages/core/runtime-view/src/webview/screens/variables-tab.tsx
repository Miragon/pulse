import { ChevronDownIcon, ChevronRightIcon, PencilIcon, TriangleAlertIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { Button, Icon, TEXT_BLOCK_FRAME, TONE_ICON, cn } from "@miragon/pulse-ui"
import type { VariableRow } from "../../core/protocol/index.js"
import { CopyButton } from "../components/copy-button.js"
import { DataTable, type Column } from "../components/data-table.js"
import { EmptyHint } from "../components/empty-hint.js"
import { NoValue } from "../components/no-value.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"
import { VariableEditor } from "./variable-editor.js"
import { VariableValueText } from "./variable-value-text.js"

export interface VariablesTabProps {
  readonly variables: readonly VariableRow[]
  readonly elementName: (elementId: string) => string
}

interface Editing {
  readonly name: string | undefined
  readonly open: (name: string) => void
  readonly close: () => void
}

const ROW_REVEAL =
  "opacity-0 focus-visible:opacity-100 in-[tr:hover]:opacity-100 in-[tr:focus-within]:opacity-100 any-pointer-coarse:opacity-100"

const COPY_REVEAL =
  "invisible focus-visible:visible in-[tr:hover]:visible in-[tr:focus-within]:visible any-pointer-coarse:visible"

function EditButton({ row, editing }: { readonly row: VariableRow; readonly editing: Editing }) {
  const write = useWriteState()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={ROW_REVEAL}
      aria-label={`Edit ${row.name}`}
      title={`Edit ${row.name}`}
      disabled={WriteStates.isWriting(write)}
      onClick={(event) => {
        event.stopPropagation()
        editing.open(row.name)
      }}
    >
      <Icon icon={PencilIcon} />
    </Button>
  )
}

function ValueText({ row, open }: { readonly row: VariableRow; readonly open: boolean }) {
  if (open) {
    return (
      <pre
        className={cn(
          "border-border bg-background text-dense my-0.5 max-w-[min(96ch,64vw)] rounded-sm border px-3 py-2 font-mono wrap-anywhere whitespace-pre-wrap",
          TEXT_BLOCK_FRAME,
        )}
      >
        {VariableValueText.readable(row)}
      </pre>
    )
  }
  const cutOff = row.truncated ? " (cut off)" : ""
  return (
    <code className="max-w-[min(64ch,56vw)] truncate font-mono" title={`${row.valueJson}${cutOff}`}>
      {row.valueJson}
    </code>
  )
}

function ValueCell({ row, editing }: { readonly row: VariableRow; readonly editing: Editing }) {
  const [open, setOpen] = useState(false)
  const expandable = VariableValueText.isExpandable(row)
  const cutOff = row.truncated ? " (cut off)" : ""
  return (
    <div
      className={cn(
        "min-h-row -ml-1 flex min-w-0 items-center gap-1",
        open && "items-start py-0.5",
      )}
    >
      {expandable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} the value of ${row.name}`}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} />
        </Button>
      )}
      <ValueText row={row} open={open} />
      {row.truncated && <span className="text-muted-foreground whitespace-nowrap">cut off</span>}
      <CopyButton
        text={row.valueJson}
        label={`value of ${row.name}${cutOff}`}
        className={COPY_REVEAL}
      />
      {row.editor !== undefined && <EditButton row={row} editing={editing} />}
    </div>
  )
}

function ValueOrEditor({
  row,
  editing,
  elementName,
}: {
  readonly row: VariableRow
  readonly editing: Editing
  readonly elementName: (elementId: string) => string
}) {
  if (row.editor !== undefined && editing.name === row.name) {
    const shadows = (row.shadowedAt ?? []).map(elementName).join(", ")
    return (
      <VariableEditor
        row={row}
        editor={row.editor}
        shadowedBy={shadows === "" ? undefined : shadows}
        onClose={editing.close}
      />
    )
  }
  return <ValueCell row={row} editing={editing} />
}

function NameCell({
  row,
  elementName,
}: {
  readonly row: VariableRow
  readonly elementName: (elementId: string) => string
}) {
  const shadows = (row.shadowedAt ?? []).map(elementName).join(", ")
  return (
    <span className="inline-flex items-center gap-1.5" data-part="variable-name">
      <code className="font-mono">{row.name}</code>
      {shadows !== "" && (
        <span
          className="inline-grid"
          role="img"
          title={`${shadows} keeps its own ${row.name}; changing this one does not reach it.`}
          aria-label={`${shadows} keeps its own ${row.name}`}
        >
          <Icon icon={TriangleAlertIcon} dense className={TONE_ICON.warning} />
        </span>
      )}
    </span>
  )
}

function useEditing(): Editing {
  const [name, setName] = useState<string | undefined>(undefined)
  const close = useCallback(() => {
    setName((closing) => {
      if (closing !== undefined) {
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`[aria-label="${CSS.escape(`Edit ${closing}`)}"]`)
            ?.focus()
        })
      }
      return undefined
    })
  }, [])
  return { name, open: setName, close }
}

export function VariablesTab({ variables, elementName }: VariablesTabProps) {
  const editing = useEditing()
  const columns: readonly Column<VariableRow>[] = [
    {
      key: "name",
      label: "Name",
      render: (row) => <NameCell row={row} elementName={elementName} />,
    },
    { key: "type", label: "Type", render: (row) => row.type ?? <NoValue /> },
    {
      key: "value",
      label: "Value",
      render: (row) => <ValueOrEditor row={row} editing={editing} elementName={elementName} />,
    },
    {
      key: "scope",
      label: "Scope",
      render: (row) =>
        row.scopeElementId === undefined ? "Process" : elementName(row.scopeElementId),
    },
  ]
  return (
    <DataTable
      label="Variables"
      resizeId="variables"
      columns={columns}
      rows={variables}
      rowKey={(row) => `${row.scopeElementId ?? ""}:${row.name}`}
      empty={<EmptyHint text="This instance has no variables." />}
    />
  )
}
