import type { ComponentProps } from "react"
import { ErrorState } from "@miragon/pulse-ui"
import { ViewDataState } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/index.js"

/**
 * A Camunda 8 cluster a screen cannot read as it is set up, which no retry of the page changes and
 * whoever runs the cluster fixes: one below the version Pulse reads (`floor`, the version it runs),
 * or one without secondary storage, which holds what the cluster's search API answers. The server
 * says both in c8-core's words after the contract's failure, `[misconfigured]` (the board says them
 * under an engine's Details); the page words them with their fix in its own language.
 */
export type ClusterProblem =
  | { readonly kind: "versionFloor"; readonly floor: string; readonly runs: string }
  | { readonly kind: "noSecondaryStorage" }

const MISCONFIGURED = "[misconfigured] "
/** c8-core's words for a cluster below its floor (version-floor.ts). */
const BELOW_FLOOR = /^Pulse reads Camunda (\d+\.\d+) or newer\. This cluster runs (\S+?)\.(?=\s|$)/
/** c8-core's words for a cluster without secondary storage (c8-failures.ts). */
const NO_SECONDARY_STORAGE = /^This cluster runs without secondary storage\b/

/** The problem a screen's failed read names, else undefined: any other failure the kit words. */
export function clusterProblemOf({ message }: Error): ClusterProblem | undefined {
  if (!message.startsWith(MISCONFIGURED)) return undefined
  const words = message.slice(MISCONFIGURED.length)
  const floor = BELOW_FLOOR.exec(words)
  if (floor) return { kind: "versionFloor", floor: String(floor[1]), runs: String(floor[2]) }
  return NO_SECONDARY_STORAGE.test(words) ? { kind: "noSecondaryStorage" } : undefined
}

/** A cluster problem's words: what happened, and what whoever runs the cluster does about it. */
export function useClusterProblemWords(engine: string) {
  const t = useT()
  return (problem: ClusterProblem) =>
    problem.kind === "versionFloor"
      ? {
          title: t("screen.cluster.floor.title", { floor: problem.floor }),
          detail: t("screen.cluster.floor.detail", {
            engine,
            runs: problem.runs,
            floor: problem.floor,
          }),
        }
      : {
          title: t("screen.cluster.storage.title", { engine }),
          detail: t("screen.cluster.storage.detail"),
        }
}

/**
 * A screen's first load in the kit's states (`ViewDataState`), but for a Camunda 8 cluster the
 * screen cannot read as it is set up (`clusterProblemOf`): that one in the page's words with its
 * fix, the server's own text under Details, and Try again, which reads the cluster anew once it is
 * fixed.
 */
export function ScreenState({
  engine,
  ...props
}: ComponentProps<typeof ViewDataState> & { readonly engine: string }) {
  const wordsOf = useClusterProblemWords(engine)
  const { error } = props
  const problem = error ? clusterProblemOf(error) : undefined
  if (!error || problem === undefined) return <ViewDataState {...props} />
  const { title, detail } = wordsOf(problem)
  return (
    <ErrorState
      title={title}
      titleAs={props.errorTitleAs}
      description={detail}
      details={error.message}
      onRetry={props.onRetry}
      retryLabel={props.retryLabel}
    />
  )
}
