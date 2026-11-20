import { Button } from "@miragon/pulse-ui"
import { useProcessWords } from "../../messages/process-words.js"

export interface LoadMoreProps {
  /** While the surface reads again: the button waits, and says why. */
  readonly busy: boolean
  /** Asks for the next page, which the surface puts after the rows shown. */
  readonly onMore: () => void
}

/** The button under a list that pages by cursor: it asks for the next page. */
export function LoadMore({ busy, onMore }: LoadMoreProps) {
  const t = useProcessWords()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      title={busy ? t("more.wait") : undefined}
      onClick={onMore}
    >
      {t("more.load")}
    </Button>
  )
}
