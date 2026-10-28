import { Button, useLocale } from "@miragon/mcp-toolkit-ui"
import { MessageSquare } from "lucide-react"
import { useHostActions } from "@miragon/mcp-toolkit-ui/app"
import type { AskAiPrompt } from "./ask-ai-prompt.js"
import { Icon, type LucideIcon } from "./icon.js"
import { kitLabels } from "./kit-labels.js"
import { MENU_ITEM } from "./menu-item.js"

/** A hand-off is never the view's primary action, so every tier but `menuitem` is the same secondary outline button. */
export type AskAiVariant = "primary" | "subtle" | "icon" | "menuitem"

export interface AskAiButtonProps {
  /** Only {@link askAiPrompt} builds one; `null` renders no button. */
  prompt: AskAiPrompt | null
  /** The concrete function's icon (CI: no sparkles, no generic "AI" symbol). */
  icon?: LucideIcon
  /** A verb phrase naming the chat ("Explain in chat"); for `icon` it moves to `aria-label`. */
  label?: string
  variant?: AskAiVariant
  title?: string
  disabled?: boolean
  onSent?: () => void
}

/** The ONLY owner of the `askAi` call site (a structural test fails on any other). Navigation and mutations must not use it. */
export function AskAiButton({
  prompt,
  icon = MessageSquare,
  label,
  variant = "subtle",
  title,
  disabled,
  onSent,
}: AskAiButtonProps) {
  const host = useHostActions()
  const locale = useLocale()
  if (prompt === null) return null
  // The kit has no catalog, so the default verb follows the ambient locale instead of leaking English.
  const effectiveLabel = label ?? kitLabels(locale).askAiDefault
  const send = () => {
    host.askAi(prompt)
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
        <Icon icon={icon} dense />
        {effectiveLabel}
      </button>
    )
  }
  const isIcon = variant === "icon"
  return (
    <Button
      type="button"
      variant="outline"
      size={isIcon ? "icon-sm" : "sm"}
      disabled={disabled}
      aria-label={isIcon ? (title ?? effectiveLabel) : undefined}
      title={isIcon ? (title ?? effectiveLabel) : title}
      onClick={send}
    >
      <Icon icon={icon} dense={isIcon} />
      {!isIcon && effectiveLabel}
    </Button>
  )
}
