import { Fragment, useRef } from "react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  useLocale,
} from "@miragon/mcp-toolkit-ui"
import { describeError } from "./describe-error.js"
import { kitLabels } from "./kit-labels.js"
import { useHostDisplayMode } from "./widget-shell.js"

export type ConfirmTarget = readonly [label: string, value: string]

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** What the write acts on, by name — at least one line. */
  target: readonly ConfirmTarget[]
  confirmLabel: string
  /** Not doing it, as verb + object ("Keep instance") — never a bare "Cancel". */
  keepLabel: string
  /** The confirm button while the write runs (default: the locale's "Working…"). */
  pendingLabel?: string
  destructive?: boolean
  /** The confirmed write is in flight: both buttons wait, the dialog stays. */
  pending?: boolean
  /** Failure of the confirmed write, shown in the dialog so it can't be missed. */
  error?: unknown
  onConfirm: () => void
}

/** An `alertdialog` with verb + object buttons, so "Keep instance" is never mistaken for "Cancel instance"; undismissable while the write runs (its outcome would be hidden). Inline in a chat (#344 K45) it centres on its opener, since a frame as tall as its content can be far taller than the chat shows. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  target,
  confirmLabel,
  keepLabel,
  pendingLabel,
  destructive = false,
  pending = false,
  error = null,
  onConfirm,
}: ConfirmDialogProps) {
  const locale = useLocale()
  const described = error ? describeError(error, locale) : null
  const inline = useHostDisplayMode() === "inline"
  const content = useRef<HTMLDivElement>(null)
  // Radix fires this before it moves the focus in, so the focus is still on the opener.
  const anchor = () => {
    const panel = content.current
    const opener = document.activeElement
    if (!inline || !panel || !opener || opener === document.body) return
    const top = anchoredTop(opener.getBoundingClientRect(), panel.offsetHeight, window.innerHeight)
    panel.style.top = `${top}px`
    panel.style.translate = "-50% 0"
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
    >
      <DialogContent
        ref={content}
        role="alertdialog"
        showCloseButton={!pending}
        onOpenAutoFocus={anchor}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-body">{description}</DialogDescription>
        </DialogHeader>
        <dl className="bg-muted text-dense grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-sm px-3 py-2">
          {target.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono break-all">{value}</dd>
            </Fragment>
          ))}
        </dl>
        {described && (
          <ErrorState
            variant="inline"
            title={described.title}
            description={described.hint}
            details={described.details ?? undefined}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {keepLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? (pendingLabel ?? kitLabels(locale).working) : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The gap the dialog keeps to the frame's edges (px). */
const FRAME_MARGIN = 16

/** At the frame's top edge when it does not fit. */
export function anchoredTop(
  opener: { top: number; height: number },
  height: number,
  frameHeight: number,
): number {
  const centred = opener.top + opener.height / 2 - height / 2
  const lowest = frameHeight - height - FRAME_MARGIN
  return Math.max(FRAME_MARGIN, Math.min(centred, lowest))
}
