import { SITUATION_TONES, StatusStrip, formatCount } from "@miragon/pulse-ui"
import { useOutsideWords } from "../messages/outside-words.js"

/**
 * An engine's open root incidents outside any process (a batch's or the history cleanup's failed
 * job), as the server's verdict judged them: `atLeast` where its incident scan stops, so `count`
 * is a lower bound (c7-core's `rootIncidentCounts`).
 */
export interface OutsideAnyProcessData {
  readonly count: number
  readonly atLeast: boolean
}

export interface OutsideAnyProcessNoticeProps {
  /** What the engine's verdict judged outside any process; none before its verdict was read. */
  readonly outside: OutsideAnyProcessData | undefined
  /** The engine the line names, where a surface shows several side by side (the start page). */
  readonly engine?: string
}

/**
 * The line of an engine's open root incidents outside any process (owner decision of 2026-11-26):
 * no process counts them, the engine's state does, so a surface shows them apart, never summed
 * into its processes' incidents ("0 incidents in processes" beside one outside any process), as a
 * strip in an open incident's tone, a lower bound (`≥ n`) where the scan stopped, which it says.
 * Nothing where none was read outside any process, nor before the verdict answered.
 */
export function OutsideAnyProcessNotice({ outside, engine }: OutsideAnyProcessNoticeProps) {
  const t = useOutsideWords()
  if (outside === undefined || outside.count === 0) return null
  const count = formatCount(outside.atLeast ? { atLeast: outside.count } : outside.count)
  const detail = t("outside.detail", { count })
  return (
    <div data-part="outside-any-process" className="contents">
      <StatusStrip
        tone={SITUATION_TONES.openIncident}
        title={
          engine === undefined
            ? t("outside.title", { count })
            : t("outside.titleOf", { engine, count })
        }
        detail={outside.atLeast ? `${detail} ${t("outside.more")}` : detail}
      />
    </div>
  )
}
