import { HistoryIcon } from "lucide-react"
import { StatusStrip, formatCount } from "@miragon/pulse-ui"
import {
  HistoryGaps,
  type InstanceListFilterData,
  type ScopeCountsData,
  type VersionData,
} from "@miragon/pulse-screens"
import { useHistoryWords } from "../../messages/history-words.js"

export interface MissingHistoryNoticeProps {
  /** The version the list shows, with the running instances its runtime counts. */
  readonly version: Pick<VersionData, "running">
  /** The filter the list's counts were read by. */
  readonly filter: InstanceListFilterData
  /** The list's counts, read after the version's (the history's), null where none were read. */
  readonly counts: ScopeCountsData | null
}

/**
 * The strip over a version's instance list whose history misses instances its runtime runs
 * (`HistoryGaps`: history level NONE, a history cleaned up while instances ran): how many the
 * history holds of those that run, and that the list shows only those. Nothing falls back to the
 * runtime's instances (the owner, 2026-11-19); without a gap it renders nothing.
 */
export function MissingHistoryNotice({ version, filter, counts }: MissingHistoryNoticeProps) {
  const t = useHistoryWords()
  const gap = HistoryGaps.of(version, filter, counts)
  if (gap === undefined) {
    return null
  }
  return (
    <StatusStrip
      tone="warning"
      icon={HistoryIcon}
      title={t("history.title")}
      detail={t("history.detail", {
        counted: formatCount(gap.counted),
        running: formatCount(gap.running),
      })}
    />
  )
}
