import { VariablesTable, type VariableEditorSlot } from "@miragon/pulse-blocks"
import { PencilIcon, TriangleAlertIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { Button, Icon, TONE_ICON } from "@miragon/pulse-ui"
import type { VariableRow } from "../../core/protocol/index.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"
import { useInstanceSlots } from "./instance-slots.js"
import { VariableEditor } from "./variable-editor.js"

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

function ShadowWarning({
  row,
  elementName,
}: {
  readonly row: VariableRow
  readonly elementName: (elementId: string) => string
}) {
  const shadows = (row.shadowedAt ?? []).map(elementName).join(", ")
  if (shadows === "") {
    return null
  }
  return (
    <span
      className="inline-grid"
      role="img"
      data-part="shadow-warning"
      title={`${shadows} keeps its own ${row.name}; changing this one does not reach it.`}
      aria-label={`${shadows} keeps its own ${row.name}`}
    >
      <Icon icon={TriangleAlertIcon} dense className={TONE_ICON.warning} />
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

function useEditorSlot(
  elementName: (elementId: string) => string,
): VariableEditorSlot<VariableRow> {
  const editing = useEditing()
  return {
    editing: (row) => {
      if (row.editor === undefined || editing.name !== row.name) {
        return undefined
      }
      const shadows = (row.shadowedAt ?? []).map(elementName).join(", ")
      return (
        <VariableEditor
          row={row}
          editor={row.editor}
          shadowedBy={shadows === "" ? undefined : shadows}
          onClose={editing.close}
        />
      )
    },
    controls: (row) =>
      row.editor === undefined ? null : <EditButton row={row} editing={editing} />,
    note: (row) => <ShadowWarning row={row} elementName={elementName} />,
  }
}

export function VariablesTab({ variables, elementName }: VariablesTabProps) {
  return (
    <VariablesTable
      variables={variables}
      nameOf={elementName}
      editor={useEditorSlot(elementName)}
      slots={useInstanceSlots()}
    />
  )
}
