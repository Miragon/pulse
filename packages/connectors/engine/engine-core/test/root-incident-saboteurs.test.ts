import { describe, expect, test } from "vitest"
import type { DefinitionSummary, VersionSummary } from "../src/index.js"
import { CASE, WORLD_PROCESS, type CaseName } from "../src/testing/index.js"
import { SabotagedRuntime, type Sabotage } from "./support/sabotaged-runtime.js"

type Counted = DefinitionSummary | VersionSummary

function processOf(summary: Counted): string {
  return "latest" in summary ? summary.latest.bpmnProcessId : summary.definition.bpmnProcessId
}

function counted<Summary extends Counted>(
  summaries: readonly Summary[],
  incidents: (summary: Summary) => number,
): Summary[] {
  return summaries.map((summary) => ({ ...summary, incidents: incidents(summary) }))
}

const copiesAtTheCaller: Sabotage = (runtime) => {
  const withCopy = (summary: Counted) =>
    summary.incidents + (processOf(summary) === WORLD_PROCESS.dispatch ? summary.withIncident : 0)
  return {
    listDefinitions: async () => counted(await runtime.listDefinitions(), withCopy),
    listVersions: async (bpmnProcessId, tenantId) =>
      counted(await runtime.listVersions(bpmnProcessId, tenantId), withCopy),
  }
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly CaseName[]])[] = [
  [
    "a call activity's copy of an incident in a called instance counts at the caller too",
    copiesAtTheCaller,
    [CASE.definitionsIncidents, CASE.versionsIncidents],
  ],
  [
    "the incidents of a process are its latest version's alone",
    (runtime) => ({
      listDefinitions: async () => {
        const summaries = await runtime.listDefinitions()
        const latest = await Promise.all(
          summaries.map(async (summary) => {
            const [newest] = await runtime.listVersions(
              summary.latest.bpmnProcessId,
              summary.latest.tenantId,
            )
            return newest?.incidents ?? 0
          }),
        )
        return summaries.map((summary, index) => ({ ...summary, incidents: latest[index] ?? 0 }))
      },
    }),
    [CASE.definitionsIncidents],
  ],
  [
    "each version counts the incidents of every version of its process",
    (runtime) => ({
      listVersions: async (bpmnProcessId, tenantId) => {
        const versions = await runtime.listVersions(bpmnProcessId, tenantId)
        const total = versions.reduce((sum, version) => sum + version.incidents, 0)
        return counted(versions, () => total)
      },
    }),
    [CASE.versionsIncidents],
  ],
  [
    "the incidents count the instances with an incident",
    (runtime) => ({
      listDefinitions: async () =>
        counted(await runtime.listDefinitions(), (summary) => summary.withIncident),
    }),
    [CASE.definitionsIncidents],
  ],
  [
    "an incident count within the world calls itself a lower bound",
    (runtime) => ({
      listDefinitions: async () =>
        (await runtime.listDefinitions()).map((summary) => ({
          ...summary,
          incidentsAtLeast: true as const,
        })),
      listVersions: async (bpmnProcessId, tenantId) =>
        (await runtime.listVersions(bpmnProcessId, tenantId)).map((summary) => ({
          ...summary,
          incidentsAtLeast: true as const,
        })),
    }),
    [CASE.definitionsIncidents, CASE.versionsIncidents],
  ],
]

describe("the root incident laws", () => {
  test.each(SABOTAGES)("catch a runtime where %s", async (_flaw, sabotage, expected) => {
    expect(await SabotagedRuntime.failingCases(SabotagedRuntime.with(sabotage))).toEqual(
      [...expected].sort(),
    )
  })
})
