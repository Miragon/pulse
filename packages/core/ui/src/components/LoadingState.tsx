import type { ReactNode } from "react"
import { LoaderCircle } from "lucide-react"
import { Icon } from "../kit/icon.js"
import { cn } from "../lib/utils.js"
import { useUiMessages } from "../locale/locale-provider.js"

export interface LoadingStateProps {
  /** What loads, in words; default: the kit's "Loading…". */
  children?: ReactNode
  className?: string
}

/**
 * The place of content that is still loading (the webview's busy hint): a 16 px spinner over the
 * words in quiet 13 px text, in the compact empty state's geometry, so the content takes its place
 * without a jump. A status region that is busy (`role="status"`, `aria-busy`). The spinner stands
 * still under reduced motion, the system's or the host's (`cd-shell-reduce-motion`).
 */
export function LoadingState({ children, className }: LoadingStateProps) {
  const { common } = useUiMessages()
  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-busy="true"
      className={cn(
        "text-dense text-muted-foreground flex flex-col items-center gap-3 px-3 py-6 text-center",
        className,
      )}
    >
      <Icon
        icon={LoaderCircle}
        className="motion-safe:animate-spin [.cd-shell-reduce-motion_&]:animate-none"
      />
      <p>{children ?? common.loading}</p>
    </div>
  )
}
