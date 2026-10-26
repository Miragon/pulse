import { useEffect, useId, useRef, useState } from "preact/hooks"
import type { VariableConditionView } from "../../core/protocol/index.js"
import {
  COMPARE_AS,
  OPERATOR_LABELS,
  OPERATORS_OF,
  VariableDraft,
  type CompareAs,
  type Draft,
  type DraftErrors,
} from "./variable-draft.js"

export interface VariableConditionDialogProps {
  readonly initial?: VariableConditionView | undefined
  readonly others: number
  readonly onApply: (condition: VariableConditionView) => void
  readonly onClose: () => void
}

interface FieldProps {
  readonly draft: Draft
  readonly errors: DraftErrors
  readonly onDraft: (change: (draft: Draft) => Draft) => void
}

function FieldError({ id, text }: { readonly id: string; readonly text: string | undefined }) {
  return text === undefined ? null : (
    <p id={id} class="condition-dialog__error">
      {text}
    </p>
  )
}

function NameField({ draft, errors, onDraft }: FieldProps) {
  const id = useId()
  return (
    <div class="condition-dialog__field">
      <label for={id}>Name</label>
      <input
        id={id}
        class="condition-dialog__control"
        value={draft.name}
        spellcheck={false}
        maxLength={255}
        autoFocus
        aria-invalid={errors.name !== undefined || undefined}
        aria-describedby={`${id}-hint ${id}-error`}
        onInput={(event) => {
          const name = event.currentTarget.value
          onDraft((current) => ({ ...current, name }))
        }}
      />
      <p id={`${id}-hint`} class="condition-dialog__hint muted">
        Names are case sensitive.
      </p>
      <FieldError id={`${id}-error`} text={errors.name} />
    </div>
  )
}

function ComparisonFields({ draft, onDraft }: FieldProps) {
  const compareAsId = useId()
  const operatorId = useId()
  return (
    <div class="condition-dialog__row">
      <div class="condition-dialog__field">
        <label for={compareAsId}>Compare as</label>
        <select
          id={compareAsId}
          class="condition-dialog__control"
          value={draft.compareAs}
          onChange={(event) => {
            const compareAs = event.currentTarget.value as CompareAs
            onDraft((current) => VariableDraft.withCompareAs(current, compareAs))
          }}
        >
          {COMPARE_AS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div class="condition-dialog__field">
        <label for={operatorId}>Operator</label>
        <select
          id={operatorId}
          class="condition-dialog__control"
          value={draft.operator}
          onChange={(event) => {
            const chosen = event.currentTarget.value as Draft["operator"]
            onDraft((current) => ({ ...current, operator: chosen }))
          }}
        >
          {OPERATORS_OF[draft.compareAs].map((option) => (
            <option key={option} value={option}>
              {OPERATOR_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function ValueControl({ id, draft, errors, onDraft }: FieldProps & { readonly id: string }) {
  const onValue = (value: string): void => {
    onDraft((current) => ({ ...current, value }))
  }
  if (draft.compareAs === "boolean") {
    return (
      <select
        id={id}
        class="condition-dialog__control"
        value={draft.value}
        onChange={(event) => {
          onValue(event.currentTarget.value)
        }}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }
  return (
    <input
      id={id}
      class="condition-dialog__control"
      value={draft.value}
      spellcheck={false}
      aria-invalid={errors.value !== undefined || undefined}
      aria-describedby={`${id}-hint ${id}-error`}
      onInput={(event) => {
        onValue(event.currentTarget.value)
      }}
    />
  )
}

function ValueField(props: FieldProps) {
  const id = useId()
  const { compareAs, operator } = props.draft
  return (
    <div class="condition-dialog__field">
      <label for={id}>Value</label>
      <ValueControl id={id} {...props} />
      <p id={`${id}-hint`} class="condition-dialog__hint muted">
        {compareAs === "auto" &&
          "Automatic compares 42 as a number, true as true or false and anything else as text."}
        {operator === "like" && " Use * as a wildcard, for example ORD-*"}
      </p>
      <FieldError id={`${id}-error`} text={props.errors.value} />
    </div>
  )
}

function useModal(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
    }
  }, [])
  const onCancel = (event: Event): void => {
    event.preventDefault()
    onClose()
  }
  return { dialog, onCancel }
}

export function VariableConditionDialog(props: VariableConditionDialogProps) {
  const { initial, others, onApply, onClose } = props
  const { dialog, onCancel } = useModal(onClose)
  const titleId = useId()
  const [draft, setDraft] = useState(() => VariableDraft.from(initial))
  const [errors, setErrors] = useState<DraftErrors>({})
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors, dialog])
  const apply = (event: Event): void => {
    event.preventDefault()
    const found = VariableDraft.errors(draft, others)
    setErrors(found)
    if (Object.keys(found).length === 0) {
      onApply(VariableDraft.condition(draft))
    }
  }
  return (
    <dialog
      ref={dialog}
      class="condition-dialog"
      aria-labelledby={titleId}
      onCancel={onCancel}
      onKeyDown={(event) => {
        event.stopPropagation()
      }}
    >
      <form class="condition-dialog__form" onSubmit={apply} noValidate>
        <h2 id={titleId} class="condition-dialog__title">
          {initial === undefined ? "Filter by variable" : "Edit variable condition"}
        </h2>
        <p class="muted">An instance matches when all conditions hold.</p>
        <NameField draft={draft} errors={errors} onDraft={setDraft} />
        <ComparisonFields draft={draft} errors={errors} onDraft={setDraft} />
        <ValueField draft={draft} errors={errors} onDraft={setDraft} />
        {errors.count !== undefined && (
          <p class="condition-dialog__error" role="alert">
            {errors.count}
          </p>
        )}
        <div class="condition-dialog__actions">
          <button type="submit" class="button button--primary">
            Apply
          </button>
          <button type="button" class="button button--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  )
}
