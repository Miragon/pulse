import { CircleAlertIcon } from "lucide-react"
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react"
import { Button, DialogBody, DialogHeader, Icon, TONE_ICON, cn } from "@miragon/pulse-ui"
import type { VariableConditionData, VariableConditionKindCode } from "@miragon/pulse-screens"
import { useProcessWords } from "../../messages/process-words.js"
import {
  ComparisonFields,
  NameField,
  ValueField,
  type DraftFieldProps,
} from "./variable-dialog-fields.js"
import { VariableDraft, type VariableDraftErrors } from "./variable-draft.js"

interface VariableConditionDialogProps {
  /** The condition to edit; none to add one. */
  readonly initial?: VariableConditionData | undefined
  /** How many conditions the filter holds beside this one. */
  readonly others: number
  /** The names the engine knows for the process's variables, offered as the name is typed. */
  readonly suggestions: readonly string[]
  /** The kinds of condition the engine refuses: offered, but disabled with their reason. */
  readonly refused: readonly VariableConditionKindCode[]
  readonly onApply: (condition: VariableConditionData) => void
  readonly onClose: () => void
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

function CountError({ shown }: { readonly shown: boolean }) {
  const t = useProcessWords()
  return shown ? (
    <p className="text-small text-danger-ink flex items-start gap-1.5" role="alert">
      <Icon icon={CircleAlertIcon} className={cn(TONE_ICON.danger, "mt-0.5")} />
      <span className="min-w-0">{t("error.count", { max: VariableDraft.MAX_CONDITIONS })}</span>
    </p>
  ) : null
}

/**
 * The dialog that adds or edits a variable condition: the variable's name (the engine's names
 * offered), how to compare it and with which operator, the value; it says inline what is wrong
 * instead of applying, and offers the kinds the engine refuses disabled, with their reason. A
 * native modal `<dialog>`: Escape closes it, the focus starts at the name.
 */
export function VariableConditionDialog(props: VariableConditionDialogProps) {
  const { initial, others, suggestions, refused, onApply, onClose } = props
  const t = useProcessWords()
  const { dialog, first, onCancel } = useModal(onClose)
  const titleId = useId()
  const descriptionId = useId()
  const [draft, setDraft] = useState(() => VariableDraft.from(initial))
  const [errors, setErrors] = useState<VariableDraftErrors>({})
  const fields: DraftFieldProps = { draft, errors, refused, onDraft: setDraft }
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors, dialog])
  const apply = (event: SyntheticEvent): void => {
    event.preventDefault()
    const found = VariableDraft.errors(draft, others, refused)
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
            {t(initial === undefined ? "dialog.add" : "dialog.edit")}
          </h2>
          <p id={descriptionId} className="text-muted-foreground text-dense">
            {t("dialog.description")}
          </p>
        </DialogHeader>
        <DialogBody className="gap-4">
          <NameField {...fields} suggestions={suggestions} input={first} />
          <ComparisonFields {...fields} />
          <ValueField {...fields} />
          <CountError shown={errors.count !== undefined} />
        </DialogBody>
        <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            {t("dialog.cancel")}
          </Button>
          <Button type="submit" size="lg">
            {t("dialog.apply")}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
