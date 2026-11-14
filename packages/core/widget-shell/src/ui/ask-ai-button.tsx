import { Button, useLocale, Icon, type LucideIcon, MENU_ITEM } from "@miragon/pulse-ui"
import { MessageSquare } from "lucide-react"
import type { AskAiPrompt } from "./ask-ai-prompt.js"
import { kitLabels } from "./kit-labels.js"
import { useViewHost } from "./view-host.js"

/**
 * A hand-off is never the view's primary action, so `primary`, `subtle` and `icon` are the same
 * secondary outline button (`icon` without its label). `toolbar` is the kit's toolbar button for
 * a view's bar: the icon and the label at 400, the label hidden visually in a narrow bar and kept
 * as its name. `menuitem` is an entry of a row's menu.
 */
export type AskAiVariant = "primary" | "subtle" | "icon" | "toolbar" | "menuitem"

/**
 * The outline button's size: `sm` (28 px) beside a view's controls, `xs` (24 px) in a table row,
 * so the row keeps the row height (28 px, 40 px on touch).
 */
export type AskAiSize = "sm" | "xs"

export interface AskAiButtonProps {
  /** Only {@link askAiPrompt} builds one; `null` renders no button. */
  prompt: AskAiPrompt | null
  /** The concrete function's icon (CI: no sparkles, no generic "AI" symbol). */
  icon?: LucideIcon
  /** A verb phrase naming the chat ("Explain in chat"); for `icon` it moves to `aria-label`. */
  label?: string
  variant?: AskAiVariant
  /** The outline variants' size (`primary`, `subtle`, `icon`); default `sm`. */
  size?: AskAiSize
  title?: string
  disabled?: boolean
  onSent?: () => void
}

const ICON_SIZE = { sm: "icon-sm", xs: "icon-xs" } as const

/** The ONLY owner of the hand-off follow-up (a structural test fails on any other). Navigation and mutations must not use it. */
export function AskAiButton({
  prompt,
  icon = MessageSquare,
  label,
  variant = "subtle",
  size = "sm",
  title,
  disabled,
  onSent,
}: AskAiButtonProps) {
  const { sendFollowUp } = useViewHost()
  const locale = useLocale()
  if (prompt === null) return null
  // The kit has no catalog, so the default verb follows the ambient locale instead of leaking English.
  const effectiveLabel = label ?? kitLabels(locale).askAiDefault
  const send = () => {
    sendFollowUp(prompt)
    onSent?.()
  }
  if (variant === "menuitem") {
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={disabled}
        title={title}
        className={MENU_ITEM}
        onClick={send}
      >
        <Icon icon={icon} />
        {effectiveLabel}
      </button>
    )
  }
  if (variant === "toolbar") {
    return (
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        disabled={disabled}
        title={title ?? effectiveLabel}
        onClick={send}
      >
        <Icon icon={icon} />
        {effectiveLabel}
      </Button>
    )
  }
  const isIcon = variant === "icon"
  return (
    <Button
      type="button"
      variant="outline"
      size={isIcon ? ICON_SIZE[size] : size}
      disabled={disabled}
      aria-label={isIcon ? (title ?? effectiveLabel) : undefined}
      title={isIcon ? (title ?? effectiveLabel) : title}
      onClick={send}
    >
      <Icon icon={icon} />
      {!isIcon && effectiveLabel}
    </Button>
  )
}
