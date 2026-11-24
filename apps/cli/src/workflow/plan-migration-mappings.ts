/**
 * The mappings of `pulse plan-migration`: the pairs of the engine's proposal a plan file can hold,
 * `--map <source>=<target>` and `--unmap <source>` read into edits, and the edits applied to the
 * proposal, each mapping with where it comes from. Pure.
 */

import { compareText, type ElementPair } from "@miragon/pulse-c7-core"
import { MigrationPlanProblems, MigrationPlanRules } from "@miragon/pulse-migration-plan"
import { usageError } from "../errors.js"

/** A mapping of the plan: the engine's, or one of `--map`. */
export interface PlannedMapping extends ElementPair {
  readonly from: "engine" | "--map"
}

/** What `--map` and `--unmap` change: the target of each source they map, the sources they drop. */
export interface PlanEdits {
  readonly map: ReadonlyMap<string, string>
  readonly unmap: ReadonlySet<string>
}

const MAP_HINT =
  "Name element ids of the BPMN models, e.g. --map Activity_CheckOrder=Activity_Review"

function elementId(id: string, flag: string, raw: string): string {
  if (MigrationPlanRules.isElementId(id)) return id
  const rule = MigrationPlanProblems.describe({ path: flag, code: "notAnElementId" })
  throw usageError(`${flag} ${raw}: ${JSON.stringify(id)} ${rule}`, MAP_HINT)
}

function mapPairs(map: readonly string[]): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const raw of map) {
    const at = raw.indexOf("=")
    if (at < 0) throw usageError(`--map expects <source>=<target>, got "${raw}"`, MAP_HINT)
    const source = elementId(raw.slice(0, at), "--map", raw)
    if (pairs.has(source)) {
      throw usageError(`--map maps ${source} twice`, "Map each element of the source version once.")
    }
    pairs.set(source, elementId(raw.slice(at + 1), "--map", raw))
  }
  return pairs
}

/** The edits of `--map` and `--unmap`; a source mapped twice, or mapped and dropped, is USAGE. */
export function parseEdits(map: readonly string[], unmap: readonly string[]): PlanEdits {
  const pairs = mapPairs(map)
  const dropped = new Set(unmap.map((raw) => elementId(raw, "--unmap", raw)))
  const both = [...dropped].find((source) => pairs.has(source))
  if (both !== undefined) {
    throw usageError(
      `--map and --unmap both name ${both}`,
      `Map ${both} with --map, or leave the engine's mapping of it out with --unmap.`,
    )
  }
  return { map: pairs, unmap: dropped }
}

/**
 * The pairs of the engine's proposal a plan file can hold (ids it reads, each source once) and
 * how many it cannot.
 */
export function usablePairs(proposal: readonly ElementPair[]): {
  readonly pairs: readonly ElementPair[]
  readonly unusable: number
} {
  const sources = new Set<string>()
  const pairs = proposal.filter((pair) => {
    const usable =
      MigrationPlanRules.isElementId(pair.sourceElementId) &&
      MigrationPlanRules.isElementId(pair.targetElementId) &&
      !sources.has(pair.sourceElementId)
    sources.add(pair.sourceElementId)
    return usable
  })
  return { pairs, unusable: proposal.length - pairs.length }
}

/**
 * The proposal with `--unmap` and then `--map` applied, sorted by source like the plan file;
 * `--unmap` of a source the engine does not map is USAGE.
 */
export function applyEdits(proposal: readonly ElementPair[], edits: PlanEdits): PlannedMapping[] {
  const proposed = new Set(proposal.map((pair) => pair.sourceElementId))
  const unproposed = [...edits.unmap].find((source) => !proposed.has(source))
  if (unproposed !== undefined) {
    throw usageError(
      `The engine proposes no mapping for ${unproposed}`,
      "--unmap takes the source element of a mapping the engine proposes; without it the view lists them (from engine).",
    )
  }
  const kept = proposal
    .filter(
      (pair) => !edits.unmap.has(pair.sourceElementId) && !edits.map.has(pair.sourceElementId),
    )
    .map((pair): PlannedMapping => ({ ...pair, from: "engine" }))
  const mapped = [...edits.map].map(([sourceElementId, targetElementId]): PlannedMapping => ({
    sourceElementId,
    targetElementId,
    from: "--map",
  }))
  return [...kept, ...mapped].sort((left, right) =>
    compareText(left.sourceElementId, right.sourceElementId),
  )
}
