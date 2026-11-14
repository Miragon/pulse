import { CircleAlertIcon } from "lucide-react"
import { useEffect, useId, useRef, useState, type RefObject, type SyntheticEvent } from "react"
import {
  Button,
  DialogBody,
  DialogHeader,
  Field,
  Icon,
  Input,
  NativeSelect,
  TONE_ICON,
  cn,
} from "@miragon/pulse-ui"
import type { RefusedVariableCondition, VariableConditionView } from "../../core/protocol/index.js"
import { VariableDraft, type CompareAs, type Draft, type DraftErrors } from "./variable-draft.js"

export interface VariableConditionDialogProps {
  readonly initial?: VariableConditionView | undefined
  readonly others: number
  readonly suggestions: readonly string[]
  readonly refused?: readonly RefusedVariableCondition[]
  readonly onApply: (condition: VariableConditionView) => void
  readonly onClose: () => void
}

interface FieldProps {
  readonly draft: Draft
  readonly errors: DraftErrors
  readonly onDraft: (change: (draft: Draft) => Draft) => void
}

function NameField({
  draft,
  errors,
  onDraft,
  suggestions,
  input,
}: FieldProps & {
  readonly suggestions: readonly string[]
  readonly input: RefObject<HTMLInputElement | null>
}) {
  const id = useId()
  return (
    <Field id={id} label="Name" hint="Names are case sensitive." error={errors.name}>
      <Input
        ref={input}
        value={draft.name}
        spellCheck={false}
        maxLength={255}
        list={`${id}-names`}
        autoComplete="off"
        onChange={(event) => {
          const name = event.currentTarget.value
          onDraft((current) => ({ ...current, name }))
        }}
      />
      <datalist id={`${id}-names`}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </Field>
  )
}

function ComparisonFields({
  draft,
  onDraft,
  refused,
}: FieldProps & { readonly refused: readonly RefusedVariableCondition[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Compare as" hint="JSON and object variables can't be searched.">
        <NativeSelect
          className="w-full"
          value={draft.compareAs}
          onChange={(event) => {
            const compareAs = event.currentTarget.value as CompareAs
            onDraft((current) => VariableDraft.withCompareAs(current, compareAs))
          }}
        >
          {VariableDraft.compareAsOptions(refused).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Operator">
        <NativeSelect
          className="w-full"
          value={draft.operator}
          onChange={(event) => {
            const chosen = event.currentTarget.value as Draft["operator"]
            onDraft((current) => ({ ...current, operator: chosen }))
          }}
        >
          {VariableDraft.operatorsOf(draft.compareAs, refused).map((option) => (
            <option key={option} value={option}>
              {VariableDraft.operatorLabel(draft.compareAs, option)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  )
}

function ValueControl({ draft, onDraft }: FieldProps) {
  const onValue = (value: string): void => {
    onDraft((current) => ({ ...current, value }))
  }
  if (draft.compareAs === "boolean") {
    return (
      <NativeSelect
        className="w-full"
        value={draft.value}
        onChange={(event) => {
          onValue(event.currentTarget.value)
        }}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </NativeSelect>
    )
  }
  return (
    <Input
      type={draft.compareAs === "date" ? "datetime-local" : "text"}
      value={draft.value}
      spellCheck={draft.compareAs === "date" ? undefined : false}
      onChange={(event) => {
        onValue(event.currentTarget.value)
      }}
    />
  )
}

function ValueField(props: FieldProps) {
  const { compareAs, operator } = props.draft
  if (compareAs === "null") {
    return null
  }
  const hint = [
    compareAs === "auto" &&
      "Automatic compares 42 as a number, true as true or false and anything else as text.",
    operator === "like" && "Use * as a wildcard, for example ORD-*",
  ]
    .filter((line) => line !== false)
    .join(" ")
  return (
    <Field label="Value" hint={hint} error={props.errors.value}>
      <ValueControl {...props} />
    </Field>
  )
}

function useModal(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    first.current?.focus()
    return () => {
      element?.close()
    }
  }, [])
  const onCancel = (event: SyntheticEvent): void => {
    event.preventDefault()
    onClose()
  }
  return { dialog, first, onCancel }
}

function CountError({ text }: { readonly text: string | undefined }) {
  return text === undefined ? null : (
    <p className="text-small text-danger-ink flex items-start gap-1.5" role="alert">
      <Icon icon={CircleAlertIcon} className={cn(TONE_ICON.danger, "mt-0.5")} />
      <span className="min-w-0">{text}</span>
    </p>
  )
}

export function VariableConditionDialog(props: VariableConditionDialogProps) {
  const { initial, others, suggestions, onApply, onClose } = props
  const { dialog, first, onCancel } = useModal(onClose)
  const titleId = useId()
  const descriptionId = useId()
  const [draft, setDraft] = useState(() => VariableDraft.from(initial))
  const [errors, setErrors] = useState<DraftErrors>({})
  const fields: FieldProps = { draft, errors, onDraft: setDraft }
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors, dialog])
  const apply = (event: SyntheticEvent): void => {
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
      className="bg-popover text-popover-foreground shadow-3 backdrop:bg-scrim m-auto w-full max-w-[min(440px,calc(100%-2rem))] rounded-md border p-0 backdrop:backdrop-blur-[3px] backdrop:backdrop-grayscale"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={onCancel}
      onKeyDown={(event) => {
        event.stopPropagation()
      }}
    >
      <form onSubmit={apply} noValidate>
        <DialogHeader>
          <h2 id={titleId} className="text-section">
            {initial === undefined ? "Filter by variable" : "Edit variable condition"}
          </h2>
          <p id={descriptionId} className="text-muted-foreground text-dense">
            An instance matches when all conditions hold.
          </p>
        </DialogHeader>
        <DialogBody className="gap-4">
          <NameField {...fields} suggestions={suggestions} input={first} />
          <ComparisonFields {...fields} refused={props.refused ?? []} />
          <ValueField {...fields} />
          <CountError text={errors.count} />
        </DialogBody>
        <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="lg">
            Apply
          </Button>
        </div>
      </form>
    </dialog>
  )
}
