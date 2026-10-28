import type { ReactNode } from "react"
import { cn } from "@miragon/mcp-toolkit-ui"
import { BreakableId } from "./id-breaks.js"

/**
 * #322 U13. Without a real name the id leads once, in mono, so it never reads
 * as a name. Ids wrap between parts first, so a long one never widens its column.
 */
export function NamedId({
  name,
  id,
  lead,
  detail,
  className,
}: {
  name: string | null | undefined
  id: string
  lead?: ReactNode
  detail?: ReadonlyArray<ReactNode>
  className?: string
}) {
  const shown = name && name !== id ? name : null
  const facts = (detail ?? []).filter((part) => part !== null && part !== undefined && part !== "")
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <span className="text-foreground text-dense flex min-w-0 items-center gap-2 font-semibold">
        {lead}
        <span className={cn(shown ? "break-words" : "font-mono wrap-anywhere")}>
          {shown ?? <BreakableId id={id} />}
        </span>
      </span>
      {(shown || facts.length > 0) && (
        <span className="text-muted-foreground text-small break-words">
          {shown && (
            <span className="font-mono wrap-anywhere">
              <BreakableId id={id} />
            </span>
          )}
          {facts.map((part, index) => (
            <span key={index}>
              {(shown || index > 0) && " · "}
              {part}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
