import { useId, type RefObject } from "react"
import { Field, Input, NativeSelect } from "@miragon/pulse-ui"
import type { VariableConditionKindCode, VariableOperatorCode } from "@miragon/pulse-screens"
import type { ProcessWordKey } from "../../messages/process-en.js"
import { useProcessWords, type ProcessWords } from "../../messages/process-words.js"
import {
  VariableDraft,
  type CompareAs,
  type VariableDraftData,
  type VariableDraftErrors,
} from "./variable-draft.js"

/** What every field of the dialog takes: the draft, what is wrong with it and how to change it. */
export interface DraftFieldProps {
  readonly draft: VariableDraftData
  readonly errors: VariableDraftErrors
  readonly refused: readonly VariableConditionKindCode[]
  readonly onDraft: (change: (draft: VariableDraftData) => VariableDraftData) => void
}

const VALUE_ERRORS = { number: "error.number", date: "error.date" } as const

/** An operator's words, which name a date's ordering and a null's comparison in their own terms. */
function operatorWord(t: ProcessWords, compareAs: CompareAs, operator: VariableOperatorCode) {
  const typed: ProcessWordKey | undefined =
    compareAs === "date" && (operator === "greaterThan" || operator === "lessThan")
      ? `operator.date.${operator}`
      : compareAs === "null" && (operator === "equals" || operator === "notEquals")
        ? `operator.null.${operator}`
        : undefined
  return t(typed ?? `operator.${operator}`)
}

/** The hint of a field, its lines joined, or none. */
function hintOf(lines: readonly (string | false)[]): string | undefined {
  const shown = lines.filter((line) => line !== false)
  return shown.length === 0 ? undefined : shown.join(" ")
}

export function NameField({
  draft,
  errors,
  onDraft,
  suggestions,
  input,
}: DraftFieldProps & {
  readonly suggestions: readonly string[]
  readonly input: RefObject<HTMLInputElement | null>
}) {
  const t = useProcessWords()
  const id = useId()
  return (
    <Field
      id={id}
      label={t("dialog.name")}
      hint={t("dialog.nameHint")}
      error={errors.name === undefined ? undefined : t("error.name")}
    >
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

function CompareAsField({ draft, errors, refused, onDraft }: DraftFieldProps) {
  const t = useProcessWords()
  return (
    <Field
      label={t("dialog.compareAs")}
      hint={hintOf([t("dialog.compareAsHint"), refused.includes("date") && t("refused.date")])}
      error={errors.refused === "date" ? t("refused.date") : undefined}
    >
      <NativeSelect
        className="w-full"
        value={draft.compareAs}
        onChange={(event) => {
          const compareAs = event.currentTarget.value as CompareAs
          onDraft((current) => VariableDraft.withCompareAs(current, compareAs, refused))
        }}
      >
        {VariableDraft.compareAsOptions().map((compareAs) => {
          const kind = VariableDraft.refusedKind(compareAs, undefined, refused)
          return (
            <option
              key={compareAs}
              value={compareAs}
              disabled={kind !== undefined}
              title={kind === undefined ? undefined : t(`refused.${kind}`)}
            >
              {t(`compareAs.${compareAs}`)}
            </option>
          )
        })}
      </NativeSelect>
    </Field>
  )
}

function OperatorField({ draft, errors, refused, onDraft }: DraftFieldProps) {
  const t = useProcessWords()
  const operators = VariableDraft.operatorsOf(draft.compareAs)
  const ordering = operators.map(
    (operator) => VariableDraft.refusedKind(draft.compareAs, operator, refused) === "ordering",
  )
  return (
    <Field
      label={t("dialog.operator")}
      hint={hintOf([ordering.includes(true) && t("refused.ordering")])}
      error={errors.refused === "ordering" ? t("refused.ordering") : undefined}
    >
      <NativeSelect
        className="w-full"
        value={draft.operator}
        onChange={(event) => {
          const chosen = event.currentTarget.value as VariableOperatorCode
          onDraft((current) => ({ ...current, operator: chosen }))
        }}
      >
        {operators.map((operator, at) => (
          <option
            key={operator}
            value={operator}
            disabled={ordering[at]}
            title={ordering[at] === true ? t("refused.ordering") : undefined}
          >
            {operatorWord(t, draft.compareAs, operator)}
          </option>
        ))}
      </NativeSelect>
    </Field>
  )
}

/** How the draft is compared: as what, and by which operator. */
export function ComparisonFields(props: DraftFieldProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <CompareAsField {...props} />
      <OperatorField {...props} />
    </div>
  )
}

function ValueControl({ draft, onDraft }: DraftFieldProps) {
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

/** The value to compare with; none to compare with null. */
export function ValueField(props: DraftFieldProps) {
  const t = useProcessWords()
  const { compareAs, operator } = props.draft
  if (compareAs === "null") {
    return null
  }
  const { value } = props.errors
  return (
    <Field
      label={t("dialog.value")}
      hint={hintOf([
        compareAs === "auto" && t("dialog.autoHint"),
        operator === "like" && t("dialog.likeHint"),
      ])}
      error={value === undefined ? undefined : t(VALUE_ERRORS[value])}
    >
      <ValueControl {...props} />
    </Field>
  )
}
