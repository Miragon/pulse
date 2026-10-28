import { useState } from "react"
import { Button, Input } from "@miragon/mcp-toolkit-ui"
import {
  Icon,
  ListTable,
  TableEmptyState,
  Td,
  useResetOnChange,
} from "@miragon/pulse-widget-shell/widgets"
import { X } from "lucide-react"

import type { ActivityTree, VariableValue } from "../view-models.js"
import { useT } from "../messages/use-t.js"
import { coerceValue, isEditableVariable } from "./lib/coerce-value.js"
import { useEngineAction, type EngineAction } from "./lib/engine-action.js"
import { writeFeedback } from "./lib/write-feedback.js"

function prettyJson(serialized: string): string {
  try {
    return JSON.stringify(JSON.parse(serialized), null, 2)
  } catch {
    return serialized
  }
}

// Omitted, `true`/`false` as the engine writes it.
export interface BooleanLabels {
  yes: string
  no: string
}

export function formatVariableValue(
  value: unknown,
  type?: string,
  booleans?: BooleanLabels,
): string {
  if (typeof value === "boolean" && booleans) return value ? booleans.yes : booleans.no
  return valueText(value, type)
}

function valueText(value: unknown, type?: string): string {
  if (value === null || value === undefined) return "—"
  // The feeds read variables serialized: Json/Object values arrive as strings.
  if ((type === "Json" || type === "Object") && typeof value === "string") return prettyJson(value)
  if (type === "Json" || type === "Object" || typeof value === "object") {
    return JSON.stringify(value, null, 2)
  }
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  return JSON.stringify(value)
}

// A serialized Json/Object string is edited and written back as that very string.
function editText(value: unknown, type?: string): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "object") return JSON.stringify(value)
  return formatVariableValue(value, type)
}

export function ActivityNode({ node, depth = 0 }: { node: ActivityTree; depth?: number }) {
  return (
    <div>
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: `${depth * 16}px` }}>
        <span className="text-muted-foreground text-small font-mono">{node.activityType}</span>
        <span className="text-dense font-medium">{node.activityName ?? node.activityId}</span>
      </div>
      {(node.childActivityInstances ?? []).map((child) => (
        <ActivityNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

interface SetVariableArgs extends Record<string, unknown> {
  processInstanceId: string
  variableName: string
  value: unknown
  type?: string
  valueInfo?: Record<string, unknown>
  engine?: string
}

function VariableRow({
  name,
  variable,
  instanceId,
  engine,
  editable,
  action,
}: {
  name: string
  variable: VariableValue
  instanceId: string
  engine?: string
  editable: boolean
  action: EngineAction<SetVariableArgs, unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  // A prior session's failed save must not reappear when the row reopens.
  const [attempted, setAttempted] = useState(false)
  // Closes when the instance stops being editable (cancelled, ended, unconfirmed).
  useResetOnChange(editable, () => setEditing(false))
  const t = useT()
  const saving = action.pending(name)
  const serverError = attempted ? action.error(name) : null

  function startEdit() {
    setEditValue(editText(variable.value, variable.type))
    setEditError(null)
    setAttempted(false)
    setEditing(true)
  }

  function save() {
    // coerceValue passes "" through for untyped/String only; an empty typed field shows the inline error
    // instead of writing a mistyped value.
    const typed = variable.type !== undefined && variable.type !== "String"
    const parsed = typed && editValue === "" ? undefined : coerceValue(editValue, variable.type)
    if (parsed === undefined) {
      setEditError(t("instanceSections.invalidValue", { type: variable.type ?? "String" }))
      return
    }
    setEditError(null)
    setAttempted(true)

    action.run(
      {
        processInstanceId: instanceId,
        variableName: name,
        value: parsed,
        type: variable.type,
        // An Object is written back with the type name + format it was read with.
        valueInfo: variable.valueInfo,
        engine,
      },
      { feedback: writeFeedback.variable(t, name), onSuccess: () => setEditing(false) },
    )
  }

  return (
    <tr className="hover:bg-muted transition-colors">
      <Td className="text-dense font-mono">{name}</Td>
      <Td className="text-muted-foreground text-small">{variable.type ?? "—"}</Td>
      <Td className="text-small max-w-md font-mono break-words whitespace-pre-wrap">
        {editing ? (
          <form
            className="flex flex-col gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <div className="flex items-center gap-1">
              <Input
                className="text-small h-7 font-mono"
                value={editValue}
                onChange={(e) => {
                  setEditValue(e.target.value)
                  setEditError(null)
                }}
                aria-invalid={editError !== null}
                autoFocus
              />
              <Button variant="outline" size="sm" type="submit" disabled={saving}>
                {t("instanceSections.save")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label={t("instanceSections.cancelEditing")}
                onClick={() => setEditing(false)}
              >
                <Icon icon={X} />
              </Button>
            </div>
            {editError && (
              <p role="alert" className="text-destructive text-small font-sans">
                {editError}
              </p>
            )}
            {/* Server-side rejection of a validly-parsed write — without this the
                Save button just re-enables and the row stays silently in edit. */}
            {!editError && serverError && (
              <p role="alert" className="text-destructive text-small font-sans">
                {t("instanceSections.saveError", { message: serverError })}
              </p>
            )}
          </form>
        ) : (
          formatVariableValue(variable.value, variable.type, {
            yes: t("value.yes"),
            no: t("value.no"),
          })
        )}
      </Td>
      {editable && (
        <Td align="right" className="w-16">
          {!editing && isEditableVariable(variable) && (
            <Button variant="ghost" size="sm" onClick={startEdit}>
              {t("instanceSections.edit")}
            </Button>
          )}
        </Td>
      )}
    </tr>
  )
}

export function VariablesTable({
  variables,
  instanceId,
  engine,
  readOnly = false,
}: {
  variables: Record<string, VariableValue>
  instanceId: string
  engine?: string
  readOnly?: boolean
}) {
  const t = useT()
  // Saved values shadow the shown ones only until the refetch.
  const setVariable = useEngineAction<SetVariableArgs>({
    tool: "camunda7_set_process_instance_variable",
    target: (args) => args.variableName,
    resetOn: variables,
    available: !readOnly,
  })
  // No edit column at all: an empty trailing column would read as missing data.
  const editable = setVariable.allowed
  const entries = Object.entries(variables)

  function getVariable(name: string, original: VariableValue): VariableValue {
    const saved = setVariable.done.get(name)
    return saved ? { ...original, value: saved.args.value } : original
  }

  if (entries.length === 0) {
    return <TableEmptyState>{t("instanceSections.noVariables")}</TableEmptyState>
  }

  return (
    <ListTable
      ariaLabel={t("instanceSections.variablesTableLabel")}
      columns={[
        { label: t("instanceSections.columnName") },
        { label: t("instanceSections.columnType") },
        { label: t("instanceSections.columnValue") },
        ...(editable ? [{ plain: true, sticky: true }] : []),
      ]}
    >
      {entries.map(([name, variable]) => (
        <VariableRow
          key={name}
          name={name}
          variable={getVariable(name, variable)}
          instanceId={instanceId}
          engine={engine}
          editable={editable}
          action={setVariable}
        />
      ))}
    </ListTable>
  )
}
