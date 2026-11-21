import { StatusStrip, useLocale } from "@miragon/pulse-ui"
import { describeError, isSessionEnded, useErrorWords } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/index.js"
import { clusterProblemOf, useClusterProblemWords } from "../cluster-problem.js"

/**
 * A row of the search's strip of failures: an engine that could not be searched (refused by the
 * server, unreachable, refusing the login), in the kit's words with its hint, a Camunda 8 cluster
 * the page cannot read as set up in the page's words with its fix, the server's own text under
 * Details; beside it the hits of the other engines stand. A page's ended session the frame's
 * notice says, once.
 */
export function SearchFailure({ engine, error }: { engine: string; error: Error }) {
  const t = useT()
  const locale = useLocale()
  const words = useErrorWords()
  const problemWords = useClusterProblemWords(engine)
  if (isSessionEnded(error)) return null
  const problem = clusterProblemOf(error)
  const described = describeError(error, locale, words)
  const fix = problem === undefined ? undefined : problemWords(problem)
  const detail =
    fix === undefined
      ? [`${described.title}.`, described.hint].filter((part) => part !== "").join(" ")
      : `${fix.title}. ${fix.detail}`
  return (
    <StatusStrip
      tone="warning"
      title={t("screen.search.failed", { engine })}
      detail={detail}
      details={described.details ?? undefined}
    />
  )
}
