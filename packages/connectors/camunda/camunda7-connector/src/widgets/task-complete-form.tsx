import { useMemo, useState } from "react"
import { Alert, AlertDescription, Button, Input, useToolQuery } from "@miragon/mcp-toolkit-ui"
import { Icon, NativeSelect } from "@miragon/pulse-widget-shell/widgets"
import { Plus, X } from "lucide-react"

import { useT } from "../messages/use-t.js"
import type { TaskFormField, TaskFormSchema } from "../view-models.js"
import { coerceValue } from "./lib/coerce-value.js"
import type { CompleteTaskAction } from "./lib/complete-task.js"
import { writeFeedback } from "./lib/write-feedback.js"

interface TaskCompleteFormProps {
  taskId: string
  // Name, else id.
  taskName: string
  // Both the form fetch and the complete call target the viewed engine, not the session default.
  engine?: string
  formSchema?: TaskFormSchema | null
  action: CompleteTaskAction
  onCompleted?: () => void
  onCancel?: () => void
}

interface ManualEntry {
  id: string
  name: string
  value: string
  type: string
}

const TYPE_OPTIONS = ["String", "Boolean", "Long", "Double", "Date", "Json"]

export function TaskCompleteForm({
  taskId,
  taskName,
  engine,
  formSchema,
  action,
  onCompleted,
  onCancel,
}: TaskCompleteFormProps) {
  const t = useT()
  const fetchedSchema = useToolQuery<TaskFormSchema>(
    ["camunda7", "task-form", engine ?? null, taskId],
    "camunda7_get_task_form",
    { taskId, engine },
    { enabled: !formSchema },
  )

  const schema = formSchema ?? fetchedSchema.data ?? null

  if (!schema) {
    if (fetchedSchema.isError) {
      return (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>
            {t("taskForm.loadError", { message: fetchedSchema.error.message })}
          </AlertDescription>
        </Alert>
      )
    }
    return <p className="text-muted-foreground text-dense py-2">{t("taskForm.loading")}</p>
  }

  return (
    <TaskCompleteFormBody
      taskId={taskId}
      taskName={taskName}
      engine={engine}
      schema={schema}
      action={action}
      onCompleted={onCompleted}
      onCancel={onCancel}
    />
  )
}

type BodyProps = Omit<TaskCompleteFormProps, "formSchema"> & { schema: TaskFormSchema }

function TaskCompleteFormBody({
  taskId,
  taskName,
  engine,
  schema,
  action,
  onCompleted,
  onCancel,
}: BodyProps) {
  const t = useT()
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    initialFieldValues(schema),
  )
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  // A delegated task went back to its owner and stays open: never shown as completed.
  const [resolvedTo, setResolvedTo] = useState<{ owner: string | null } | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)
    setResolvedTo(null)

    const variables: Record<string, { value: unknown; type?: string }> = {}

    for (const field of schema.fields) {
      if (field.readonly) continue
      const raw = fieldValues[field.name]
      const required = isRequired(field)
      if (raw === undefined || raw === "") {
        if (required) {
          setSubmitError(t("taskForm.errorRequired", { name: field.name }))
          return
        }
        continue
      }
      const coerced = coerceValue(raw, field.type)
      if (coerced === undefined) {
        setSubmitError(
          t("taskForm.errorInvalid", { name: field.name, type: field.type ?? "value" }),
        )
        return
      }
      variables[field.name] = { value: coerced, type: field.type ?? "String" }
    }

    for (const entry of manualEntries) {
      const name = entry.name.trim()
      if (!name) continue
      if (entry.value === "") continue
      const coerced = coerceValue(entry.value, entry.type)
      if (coerced === undefined) {
        setSubmitError(t("taskForm.errorInvalid", { name, type: entry.type }))
        return
      }
      variables[name] = { value: coerced, type: entry.type }
    }

    // A completion opens the next task, a resolve shows the owner as assignee again.
    action.run(
      { taskId, variables, engine },
      {
        feedback: writeFeedback.completeTask(t, taskName),
        onSuccess: (result) => {
          if (result?.outcome === "resolved") {
            setResolvedTo({ owner: result.assignee ?? null })
            return
          }
          onCompleted?.()
        },
        onError: (error) => setSubmitError(error.message),
      },
    )
  }

  const editableFields = schema.fields.filter((f) => !f.readonly)
  const readonlyFields = schema.fields.filter((f) => f.readonly)

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      {schema.fields.length === 0 && manualEntries.length === 0 && (
        <p className="text-muted-foreground text-dense">
          {schema.formKey || schema.formRef
            ? t("taskForm.externalForm", { formKey: schema.formKey ?? schema.formRef ?? "" })
            : t("taskForm.empty")}
        </p>
      )}
      {readonlyFields.length > 0 && (
        <div className="flex flex-col gap-2">
          {readonlyFields.map((field) => (
            <FieldRow
              key={field.name}
              field={field}
              value={fieldValues[field.name] ?? ""}
              onChange={() => undefined}
            />
          ))}
        </div>
      )}
      {readonlyFields.length > 0 && editableFields.length > 0 && <hr className="border-border" />}
      {editableFields.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          value={fieldValues[field.name] ?? ""}
          onChange={(v) => setFieldValues((prev) => ({ ...prev, [field.name]: v }))}
        />
      ))}
      {manualEntries.map((entry) => (
        <ManualEntryRow
          key={entry.id}
          entry={entry}
          onChange={(updated) =>
            setManualEntries((prev) => prev.map((e) => (e.id === entry.id ? updated : e)))
          }
          onRemove={() => setManualEntries((prev) => prev.filter((e) => e.id !== entry.id))}
        />
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setManualEntries((prev) => [
              ...prev,
              { id: crypto.randomUUID(), name: "", value: "", type: "String" },
            ])
          }
        >
          <Icon icon={Plus} />
          {t("taskForm.addVariable")}
        </Button>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {t("taskForm.cancel")}
            </Button>
          )}
          <CompleteButton action={action} taskId={taskId} />
        </div>
      </div>
      {resolvedTo && (
        <Alert role="status">
          <AlertDescription>
            {t("taskForm.resolved", { owner: resolvedTo.owner ?? "—" })}
          </AlertDescription>
        </Alert>
      )}
      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}

function CompleteButton({ action, taskId }: { action: CompleteTaskAction; taskId: string }) {
  const t = useT()
  if (!action.allowed) return null
  const pending = action.pending(taskId)
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? t("taskForm.completing") : t("taskForm.complete")}
    </Button>
  )
}

function isRequired(field: TaskFormField): boolean {
  if (field.required === true) return true
  if (field.required === false) return false
  return false
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: TaskFormField
  value: string
  onChange: (v: string) => void
}) {
  const t = useT()
  const label = field.label ?? field.name
  const required = isRequired(field)
  const disabled = field.readonly === true

  const meta = useMemo(() => {
    const parts: string[] = []
    if (field.type) parts.push(field.type)
    if (required) parts.push(t("taskForm.required"))
    return parts.join(" · ")
  }, [field.type, required, t])

  if (field.suggestedValues && field.suggestedValues.length > 0) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <label className="text-muted-foreground text-dense font-medium">{label}</label>
          <span className="text-muted-foreground text-small">{meta}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {field.suggestedValues.map((suggested) => {
            const stringified = stringifyValue(suggested)
            const selected = value === stringified
            return (
              <Button
                key={stringified}
                type="button"
                size="sm"
                variant={selected ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onChange(stringified)}
              >
                {stringified}
              </Button>
            )
          })}
        </div>
      </div>
    )
  }

  if (field.type === "Boolean") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <label className={`text-dense font-medium ${disabled ? "text-muted-foreground" : ""}`}>
            {label}
          </label>
          <span className="text-muted-foreground text-small">{meta}</span>
        </div>
        {/* The engine value stays "true"/"false"; the screen says Ja/Nein. */}
        <div className="flex gap-1">
          {(["true", "false"] as const).map((choice) => (
            <Button
              key={choice}
              type="button"
              size="sm"
              variant={value === choice ? "default" : "outline"}
              aria-pressed={value === choice}
              disabled={disabled}
              onClick={() => onChange(choice)}
            >
              {t(choice === "true" ? "value.yes" : "value.no")}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={`field-${field.name}`}
          className={`text-dense font-medium ${disabled ? "text-muted-foreground" : ""}`}
        >
          {label}
        </label>
        <span className="text-muted-foreground text-small">{meta}</span>
      </div>
      <Input
        id={`field-${field.name}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
        // ISO 8601, converted to the engine's date format server-side.
        placeholder={field.type === "Date" ? "YYYY-MM-DD" : undefined}
        disabled={disabled}
      />
    </div>
  )
}

function ManualEntryRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: ManualEntry
  onChange: (updated: ManualEntry) => void
  onRemove: () => void
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-1">
      <Input
        aria-label={t("taskForm.variableName")}
        className="h-8 flex-1"
        placeholder={t("taskForm.namePlaceholder")}
        value={entry.name}
        onChange={(e) => onChange({ ...entry, name: e.target.value })}
      />
      <NativeSelect
        aria-label={t("taskForm.variableType")}
        className="text-small h-8"
        value={entry.type}
        onChange={(e) => onChange({ ...entry, type: e.target.value })}
      >
        {TYPE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label={t("taskForm.variableValue")}
        className="h-8 flex-1"
        placeholder={t("taskForm.valuePlaceholder")}
        value={entry.value}
        onChange={(e) => onChange({ ...entry, value: e.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("taskForm.removeVariable")}
        onClick={onRemove}
      >
        <Icon icon={X} />
      </Button>
    </div>
  )
}

function initialFieldValues(schema: TaskFormSchema): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of schema.fields) {
    if (field.defaultValue !== undefined) {
      values[field.name] = stringifyValue(field.defaultValue)
    } else {
      values[field.name] = ""
    }
  }
  return values
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
    return String(value)
  }
  return JSON.stringify(value)
}
