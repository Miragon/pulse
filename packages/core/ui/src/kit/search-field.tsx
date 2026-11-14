import {
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react"
import { Search, X } from "lucide-react"

import { FieldControlContext, useFieldControl } from "../lib/field-control.js"
import { cn } from "../lib/utils.js"
import { FIELD_TEXT } from "../lib/typography.js"
import { useUiMessages } from "../locale/locale-provider.js"
import { Button } from "../primitives/button.js"
import { Icon } from "./icon.js"
import { useResetOnChange } from "./use-reset-on-change.js"

export interface SearchFieldProps extends Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type" | "children"
> {
  /**
   * The search in effect: the text the list is filtered by now. The field shows it, and follows
   * it whenever it changes to a text the field did not ask for (a reset, a link, a view that
   * opened with a search), dropping what was typed meanwhile.
   */
  value: string
  /**
   * Called with the trimmed text once typing pauses for `delayMs`, at once on Enter, on the
   * clear button and on Escape; never twice in a row with the same text.
   */
  onChange: (text: string) => void
  /** How long typing pauses before the search applies. Default 300 ms. */
  delayMs?: number
  /** Classes of the field's box (its width, say). */
  className?: string
}

/** The typed text, debounced into `onChange`, following `value` when it changes from outside. */
function useAppliedSearch(value: string, onChange: (text: string) => void, delayMs: number) {
  const [text, setText] = useState(value)
  // What the field last asked for, or the applied value it took over.
  const [requested, setRequested] = useState(value)
  useResetOnChange(value, () => {
    if (value !== requested) {
      setText(value)
      setRequested(value)
    }
  })
  const apply = (next: string) => {
    const wanted = next.trim()
    if (wanted === requested) return
    setRequested(wanted)
    onChange(wanted)
  }
  const applyLater = useEffectEvent(apply)
  useEffect(() => {
    if (text.trim() === requested) return undefined
    const timer = setTimeout(() => applyLater(text), delayMs)
    return () => clearTimeout(timer)
  }, [text, requested, delayMs])
  const clear = () => {
    setText("")
    apply("")
  }
  return { text, setText, apply, clear }
}

/**
 * A search box (the webview's filter search, CI §8 fields): a field of the control height on the
 * ground with a 16 px search icon inside before the text, and a clear button while it holds text.
 * 200 px wide; inside an `@container` narrower than 1180 px (73.75rem) it shrinks to 120 px. Its
 * box takes the field's focus edge while the input has focus. Typing applies after a pause
 * (`delayMs`), Enter at once; the clear button and Escape empty it and apply at once, the clear
 * button handing focus back to the input. Named by the kit's catalogue ("Search") unless you name
 * it (`aria-label`, or a `Field` around it, whose label, hint and error it takes).
 */
export function SearchField({
  value,
  onChange,
  delayMs = 300,
  className,
  placeholder,
  disabled,
  onKeyDown,
  "aria-label": ariaLabel,
  ...props
}: SearchFieldProps) {
  const { searchField } = useUiMessages()
  const inField = useContext(FieldControlContext) !== null
  const control = useFieldControl(props)
  const input = useRef<HTMLInputElement>(null)
  const search = useAppliedSearch(value, onChange, delayMs)
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === "Enter") search.apply(search.text)
    if (event.key === "Escape" && search.text !== "") {
      event.preventDefault()
      search.clear()
    }
  }
  const invalid = ![undefined, false, "false"].includes(control["aria-invalid"])
  return (
    <div
      data-slot="search-field"
      className={cn(
        "border-input bg-background text-foreground min-h-control inline-flex w-50 max-w-full shrink-0 items-center gap-1.5 rounded-sm border pr-0.5 pl-2 transition-[color,box-shadow,border-color]",
        "@max-[73.75rem]:min-w-30 @max-[73.75rem]:shrink",
        "has-[input:focus-visible]:border-focus has-[input:focus-visible]:ring-focus has-[input:focus-visible]:ring-[length:calc(var(--focus-width)-1px)]",
        invalid && "border-danger ring-danger ring-1",
        disabled && "bg-accent text-muted-foreground cursor-not-allowed",
        className,
      )}
    >
      <Icon icon={Search} className="text-muted-foreground" />
      <input
        ref={input}
        type="search"
        aria-label={ariaLabel ?? (inField ? undefined : searchField.label)}
        placeholder={placeholder ?? searchField.placeholder}
        disabled={disabled}
        value={search.text}
        onChange={(event) => search.setText(event.target.value)}
        onKeyDown={keyDown}
        className={cn(
          "placeholder:text-muted-foreground min-w-0 flex-1 self-stretch bg-transparent focus-visible:outline-hidden disabled:cursor-not-allowed forced-colors:focus-visible:-outline-offset-2 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
          FIELD_TEXT,
        )}
        {...control}
      />
      {search.text !== "" && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={searchField.clear}
          className="text-muted-foreground focus-visible:ring-offset-0"
          onClick={() => {
            search.clear()
            input.current?.focus()
          }}
        >
          <Icon icon={X} />
        </Button>
      )}
    </div>
  )
}
