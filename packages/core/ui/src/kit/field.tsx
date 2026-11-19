import { useId, type ReactNode } from "react"
import { CircleAlert } from "lucide-react"

import { FieldControlContext, type FieldControlProps } from "../lib/field-control.js"
import { cn } from "../lib/utils.js"
import { Label } from "../primitives/label.js"
import { Icon } from "./icon.js"

export interface FieldProps {
  /** The control's name, above it (13 px at 600). */
  label: ReactNode
  /** What to enter, a quiet line below the control, read out with it. */
  hint?: ReactNode
  /**
   * What is wrong with the entry and what to enter instead, below the control next to a danger
   * icon, read out with it; the control is invalid (`aria-invalid`) while it shows. The entry stays
   * as typed: never correct or clamp it silently.
   */
  error?: ReactNode
  /** The control's id, which the label names. Default: one of its own. */
  id?: string
  /**
   * One kit control (`Input`, `Textarea`, `NativeSelect`, `SearchField`, `Checkbox`), which takes
   * the id, the hint and the error by itself; or a function that spreads them onto another
   * control.
   */
  children: ReactNode | ((control: FieldControlProps) => ReactNode)
  className?: string
}

/** Whether a slot renders something: `false`, `null`, `undefined` and `""` show nothing. */
const shows = (node: ReactNode): boolean =>
  node !== undefined && node !== null && node !== false && node !== ""

/**
 * A form field (CI §8 "Eingabefelder"): the label 4 px above the control, a hint and an error
 * below it, all wired to the control (`htmlFor`, `aria-describedby` with the hint first,
 * `aria-invalid` while the error shows), so a screen reader reads them with it. Fields stack 16
 * px apart (`gap-4` on their container). The label turns quiet while the control is disabled.
 * Props and callbacks only: the entry, its check and its error are the caller's.
 */
export function Field({ label, hint, error, id, children, className }: FieldProps) {
  const own = useId()
  const controlId = id ?? own
  const hintId = shows(hint) ? `${controlId}-hint` : undefined
  const errorId = shows(error) ? `${controlId}-error` : undefined
  const describedBy = [hintId, errorId].filter((part) => part !== undefined).join(" ")
  const control: FieldControlProps = { id: controlId }
  if (describedBy !== "") control["aria-describedby"] = describedBy
  if (errorId !== undefined) control["aria-invalid"] = true
  return (
    <div data-slot="field" className={cn("group/field flex flex-col gap-1", className)}>
      <Label
        htmlFor={controlId}
        className="group-has-[:disabled]/field:text-muted-foreground self-start"
      >
        {label}
      </Label>
      {typeof children === "function" ? (
        children(control)
      ) : (
        <FieldControlContext.Provider value={control}>{children}</FieldControlContext.Provider>
      )}
      {hintId !== undefined && (
        <p id={hintId} data-slot="field-hint" className="text-small text-muted-foreground">
          {hint}
        </p>
      )}
      {errorId !== undefined && (
        <p
          id={errorId}
          data-slot="field-error"
          className="text-small text-danger-ink flex items-start gap-1.5"
        >
          <Icon icon={CircleAlert} className="text-danger mt-0.5" />
          <span className="min-w-0 wrap-anywhere">{error}</span>
        </p>
      )}
    </div>
  )
}
