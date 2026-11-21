import { HistoryIcon } from "lucide-react"
import { StatusStrip, formatCount } from "@miragon/pulse-ui"
import type { FindScreenData } from "@miragon/pulse-screens"
import { useFindWords } from "../../messages/find-words.js"

export interface FindHistoryNoticeProps {
  /** What an engine found, with the gap of its history where it misses running instances. */
  readonly found: Pick<FindScreenData, "engine" | "historyGap">
}

/**
 * The strip beside what the search found on an engine whose history misses instances its runtime
 * runs (Camunda 7 at history level NONE, a history cleaned up while instances ran): how many the
 * history holds of those that run, and that the search finds only those. Nothing falls back to the
 * runtime's instances (the owner, 2026-11-19); without a gap it renders nothing.
 */
export function FindHistoryNotice({ found }: FindHistoryNoticeProps) {
  const t = useFindWords()
  const gap = found.historyGap
  if (gap === null) {
    return null
  }
  return (
    <StatusStrip
      tone="warning"
      icon={HistoryIcon}
      title={t("find.history.title", { engine: found.engine })}
      detail={t("find.history.detail", {
        counted: formatCount(gap.counted),
        running: formatCount(gap.running),
      })}
    />
  )
}
