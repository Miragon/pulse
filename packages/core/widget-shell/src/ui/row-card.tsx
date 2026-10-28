import type { ReactNode } from "react"
import { cn } from "@miragon/mcp-toolkit-ui"

export function RowCard({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "border-border flex items-center justify-between gap-3 rounded-md border p-3",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-dense flex items-center gap-2 font-medium">{title}</div>
        {subtitle && <div className="text-muted-foreground text-small truncate">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
}
