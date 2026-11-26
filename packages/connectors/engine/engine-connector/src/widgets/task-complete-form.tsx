import { useMemo, useState } from "react"
import { Button, Input, SegmentedControl } from "@miragon/pulse-ui"
import { QueryFallback, TableSkeleton, useToolQuery } from "@miragon/pulse-widget-shell/widgets"

import { useT } from "../messages/use-t.js"
import type { TaskFormField, TaskFormSchema } from "../view-models.js"
import type { CompleteTaskAction } from "./lib/complete-task.js"
import { writeFeedback } from "./lib/write-feedback.js"
import { FormActions, FormOutcome } from "./task-form/form-footer.js"
import { ManualEntries } from "./task-form/manual-entries.js"
import {
  collectVariables,
  initialFieldValues,
  isRequired,
  type ManualEntry,
  stringifyValue,
} from "./task-form/values.js"

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
    ["engine", "task-form", engine ?? null, taskId],
    "engine_get_task_form",
    { taskId, engine },
    { enabled: !formSchema },
  )

  const schema = formSchema ?? fetchedSchema.data ?? null

  if (!schema) {
    return (
      <QueryFallback
        isError={fetchedSchema.isError}
        error={fetchedSchema.error}
        onRetry={() => void fetchedSchema.refetch()}
        errorTitle={t("taskForm.loadError")}
        loadingText={t("taskForm.loading")}
        skeleton={<TableSkeleton />}
      />
    )
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

/**
 * The form's state: the fields' values, the variables added by hand, and what the last send came
 * to. A send checks every entry first and sends nothing the form cannot take.
 */
function useTaskForm({ taskId, taskName, engine, schema, action, onCompleted }: BodyProps) {
  const t = useT()
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    initialFieldValues(schema),
  )
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The engine's answer, apart from the form's own check: worded, its text under "Details".
  const [writeError, setWriteError] = useState<Error | null>(null)
  // A delegated task went back to its owner and stays open: never shown as completed.
  const [resolvedTo, setResolvedTo] = useState<{ owner: string | null } | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)
    setWriteError(null)
    setResolvedTo(null)
    const collected = collectVariables(t, schema, fieldValues, manualEntries)
    if (collected.error !== null) {
      setSubmitError(collected.error)
      return
    }
    // A completion opens the next task, a resolve shows the owner as assignee again.
    action.run(
      { taskId, variables: collected.variables, engine },
      {
        feedback: writeFeedback.completeTask(t, taskName),
        onSuccess: (result) => {
          if (result?.outcome === "resolved") {
            setResolvedTo({ owner: result.assignee ?? null })
            return
          }
          onCompleted?.()
        },
        onError: (error) => setWriteError(error),
      },
    )
  }

  const setField = (name: string, value: string) =>
    setFieldValues((prev) => ({ ...prev, [name]: value }))
  const addEntry = () =>
    setManualEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: "", value: "", type: "String" },
    ])
  const outcome = { resolvedTo, submitError, writeError }
  return { fieldValues, setField, manualEntries, setManualEntries, addEntry, outcome, handleSubmit }
}

/** Why the form shows nothing to fill in: the task's own form lives elsewhere, or it has none. */
function NoFieldsNote({ schema }: { schema: TaskFormSchema }) {
  const t = useT()
  return (
    <p className="text-muted-foreground text-dense">
      {schema.formKey || schema.formRef
        ? t("taskForm.externalForm", { formKey: schema.formKey ?? schema.formRef ?? "" })
        : t("taskForm.empty")}
    </p>
  )
}

/** The form's fields: the read-only ones first, under a rule the ones to fill in. */
function SchemaFields({
  schema,
  values,
  onChange,
}: {
  schema: TaskFormSchema
  values: Record<string, string>
  onChange: (name: string, value: string) => void
}) {
  const editableFields = schema.fields.filter((f) => !f.readonly)
  const readonlyFields = schema.fields.filter((f) => f.readonly)
  return (
    <>
      {readonlyFields.length > 0 && (
        <div className="flex flex-col gap-2">
          {readonlyFields.map((field) => (
            <FieldRow
              key={field.name}
              field={field}
              value={values[field.name] ?? ""}
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
          value={values[field.name] ?? ""}
          onChange={(v) => onChange(field.name, v)}
        />
      ))}
    </>
  )
}

function TaskCompleteFormBody(props: BodyProps) {
  const { schema } = props
  const form = useTaskForm(props)
  return (
    <form className="flex flex-col gap-3" onSubmit={form.handleSubmit}>
      {schema.fields.length === 0 && form.manualEntries.length === 0 && (
        <NoFieldsNote schema={schema} />
      )}
      <SchemaFields schema={schema} values={form.fieldValues} onChange={form.setField} />
      <ManualEntries entries={form.manualEntries} setEntries={form.setManualEntries} />
      <FormActions
        action={props.action}
        taskId={props.taskId}
        onAdd={form.addEntry}
        onCancel={props.onCancel}
      />
      <FormOutcome {...form.outcome} />
    </form>
  )
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
  const labelClass = `text-dense font-semibold ${disabled ? "text-muted-foreground" : ""}`

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
          <label className="text-muted-foreground text-dense font-semibold">{label}</label>
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
          <span className={labelClass}>{label}</span>
          <span className="text-muted-foreground text-small">{meta}</span>
        </div>
        {/* A radio group named by the words above; the engine still gets "true"/"false". */}
        <SegmentedControl<string>
          ariaLabel={label}
          options={[
            { value: "true", label: t("value.yes") },
            { value: "false", label: t("value.no") },
          ]}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="self-start"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={`field-${field.name}`} className={labelClass}>
          {label}
        </label>
        <span className="text-muted-foreground text-small">{meta}</span>
      </div>
      <Input
        id={`field-${field.name}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // ISO 8601, converted to the engine's date format server-side.
        placeholder={field.type === "Date" ? "YYYY-MM-DD" : undefined}
        disabled={disabled}
      />
    </div>
  )
}
