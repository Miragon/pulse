import {
  Button,
  useLocale,
  useToast,
  Icon,
  type LucideIcon,
  MENU_ITEM,
  type ToastApi,
} from "@miragon/pulse-ui"
import { Copy, MessageSquare } from "lucide-react"
import type { AskAiPrompt } from "./ask-ai-prompt.js"
import { copyText } from "./id-text.js"
import { kitLabels, type KitLabels } from "./kit-labels.js"
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

/** The hand-off as this host does it: posted into the chat, or its prompt copied for one. */
interface HandOff {
  icon: LucideIcon
  label: string
  title: string | undefined
  run: () => void
}

async function copyPrompt(prompt: AskAiPrompt, toast: ToastApi, words: KitLabels): Promise<void> {
  if (await copyText(prompt)) {
    toast.show({ tone: "success", title: words.promptCopied })
  } else {
    toast.show({
      tone: "danger",
      title: words.promptCopyFailed,
      description: words.promptCopyFailedHint,
    })
  }
}

/** `null` where the host shows no hand-off; where it posts to no chat, the prompt is copied. */
function useHandOff(
  prompt: AskAiPrompt | null,
  { icon = MessageSquare, label, title, onSent }: AskAiButtonProps,
): HandOff | null {
  const { sendFollowUp, followUp } = useViewHost()
  const toast = useToast()
  // The kit has no catalog, so the default verb follows the ambient locale instead of leaking English.
  const words = kitLabels(useLocale())
  if (prompt === null || followUp === "none") return null
  const chatLabel = label ?? words.askAiDefault
  if (followUp === "copy") {
    return {
      icon: Copy,
      label: words.copyPrompt(chatLabel),
      title: title === undefined ? undefined : words.copyPrompt(title),
      run: () => {
        void copyPrompt(prompt, toast, words)
        onSent?.()
      },
    }
  }
  return {
    icon,
    label: chatLabel,
    title,
    run: () => {
      sendFollowUp(prompt)
      onSent?.()
    },
  }
}

/** The ONLY owner of the hand-off follow-up (a structural test fails on any other). Navigation and mutations must not use it. */
export function AskAiButton(props: AskAiButtonProps) {
  const { prompt, variant = "subtle", size = "sm", disabled } = props
  const handOff = useHandOff(prompt, props)
  if (handOff === null) return null
  const { icon, label, title, run } = handOff
  if (variant === "menuitem") {
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={disabled}
        title={title}
        className={MENU_ITEM}
        onClick={run}
      >
        <Icon icon={icon} />
        {label}
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
        title={title ?? label}
        onClick={run}
      >
        <Icon icon={icon} />
        {label}
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
      aria-label={isIcon ? (title ?? label) : undefined}
      title={isIcon ? (title ?? label) : title}
      onClick={run}
    >
      <Icon icon={icon} />
      {!isIcon && label}
    </Button>
  )
}
