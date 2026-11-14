import type { ReactNode } from "react"
import { Button } from "@miragon/pulse-ui"

export interface EmptyHintProps {
  readonly text: string
  readonly busy?: boolean
  readonly action?: { readonly label: string; readonly onClick: () => void }
  readonly children?: ReactNode
}

export function EmptyHint({ text, busy = false, action, children }: EmptyHintProps) {
  return (
    <div
      className="text-dense text-muted-foreground flex flex-col items-center justify-center gap-3 px-3 py-6 text-center"
      data-part="empty-hint"
      role={busy ? "status" : undefined}
      aria-busy={busy || undefined}
    >
      {children}
      <p className="max-w-prose text-balance">{text}</p>
      {action !== undefined && (
        <Button type="button" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
