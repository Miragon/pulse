import { StatusStrip, useLocale } from "@miragon/pulse-ui"
import { describeError, isSessionEnded, useErrorWords } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/index.js"
import { clusterProblemOf, useClusterProblemWords } from "./cluster-problem.js"

/**
 * A row of a screen's strip of failures across engines: an engine that could not be read (refused
 * by the server, unreachable, refusing the login), under the screen's title for it (`title`), in
 * the kit's words with its hint, a Camunda 8 cluster the page cannot read as set up in the page's
 * words with its fix, the server's own text under Details; beside it what the other engines gave
 * stands. Where the screen still shows what the engine gave before (`stale`), it says so. A page's
 * ended session the frame's notice says, once.
 */
export function EngineFailure({
  engine,
  error,
  title,
  stale = false,
}: {
  engine: string
  error: Error
  title: string
  stale?: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const words = useErrorWords()
  const problemWords = useClusterProblemWords(engine)
  if (isSessionEnded(error)) return null
  const problem = clusterProblemOf(error)
  const described = describeError(error, locale, words)
  const fix = problem === undefined ? undefined : problemWords(problem)
  const said =
    fix === undefined
      ? [`${described.title}.`, described.hint].filter((part) => part !== "").join(" ")
      : `${fix.title}. ${fix.detail}`
  return (
    <StatusStrip
      tone="warning"
      title={title}
      detail={stale ? `${said} ${t("screen.refreshStale")}` : said}
      details={described.details ?? undefined}
    />
  )
}
