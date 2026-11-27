import { describe, expect, it } from "vitest"
import { engineDateMillis } from "../dates.js"
import { elementOfActivity } from "../multi-instance-body.js"
import { C7_STATUS_WORLD } from "./status-world.js"
import { C7_STATUS_ENGINE, type C7RecordedStatusEngine } from "./status-engine.js"

/**
 * The recorded status engines' expectations held to each other, so a recording made anew in which
 * two surfaces count apart where this test relates them, or which lost one of the world's cases,
 * fails here before any surface builds it: the CLI's `pulse status` and `engine_status` (both
 * c7-core's `readStatus`) state the same, the web app's verdict feed and the chat overview's health
 * judge as they do, by default and at the two thresholds on the world's edge, the health sums the
 * processes' root incidents the definitions count, forms its last hour, its affected activities
 * and its causes from the processes' root incidents alone and names the ones outside any process
 * apart, and each of the world's cases reads as seeded.
 */

const HOUR_MS = 3_600_000

interface Outside {
  readonly count: number
  readonly atLeast: boolean
}

interface Definition {
  readonly key: string
  readonly instances: number
  readonly incidents: number
}

interface Status {
  readonly engine: { readonly version: string | null; readonly latencyMs: number }
  readonly status: string
  readonly findings: readonly Record<string, unknown>[]
  readonly definitions: readonly Definition[]
  readonly incidents: readonly (Record<string, unknown> & {
    readonly activityId: string
    readonly count: number
    readonly firstAt: string
  })[]
  readonly rootIncidentsTotal: number
  readonly outsideAnyProcess: Outside
  readonly incidentsTotal: number
  readonly propagated: number
  readonly externalTasks: readonly unknown[]
  readonly jobs: unknown
  readonly tasks: { readonly open: number }
  readonly batches: unknown
  readonly truncated?: readonly string[]
}

interface Health {
  readonly status: string
  readonly clusters: readonly {
    readonly incidentCount: number | null
    readonly processDefinitionKeys: readonly string[]
  }[]
  readonly summary: {
    readonly totalIncidents: number
    readonly outsideAnyProcess: Outside
    readonly lastHourIncidents: number | null
    readonly affectedActivities: number | null
    readonly affectedDefinitions: number
    readonly runningInstances: number
    readonly totalDefinitions: number
    readonly started24h: number | null
    readonly completed24h: number | null
    readonly historyRecorded: boolean | null
  }
}

/** One engine's expectations, typed as the surfaces give them. */
function expectedOf(recorded: C7RecordedStatusEngine) {
  const { cliStatus, engineStatus, verdict, health } = recorded.expected
  return {
    cli: cliStatus as Status,
    status: engineStatus as Status,
    verdict: verdict as { readonly status: string; readonly outsideAnyProcess: Outside },
    health: health as Health,
    atEdges: recorded.expected.atEdges,
  }
}

/** A list without each entry's next step, which only the CLI words (as a command line). */
const withoutNext = (rows: readonly Record<string, unknown>[]) =>
  rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "next")))

/** What `pulse status` and `engine_status` both state, each wording its next steps its own way. */
function statedByBoth(status: Status) {
  return {
    version: status.engine.version,
    latencyMs: status.engine.latencyMs,
    status: status.status,
    findings: withoutNext(status.findings),
    definitions: status.definitions,
    incidents: withoutNext(status.incidents),
    rootIncidentsTotal: status.rootIncidentsTotal,
    outsideAnyProcess: status.outsideAnyProcess,
    incidentsTotal: status.incidentsTotal,
    propagated: status.propagated,
    externalTasks: status.externalTasks,
    jobs: status.jobs,
    tasks: status.tasks,
    batches: status.batches,
    truncated: status.truncated,
  }
}

const sum = (definitions: readonly Definition[], count: (row: Definition) => number) =>
  definitions.reduce((total, row) => total + count(row), 0)

describe("C7_STATUS_ENGINE", () => {
  it("holds the status world at history level full, then at none, read at one instant", () => {
    expect(C7_STATUS_ENGINE.about).toMatch(/^\S.+\.$/)
    expect(new Date(C7_STATUS_ENGINE.asOf).toISOString()).toBe(C7_STATUS_ENGINE.asOf)
    expect(
      C7_STATUS_ENGINE.engines.map(({ engine, historyLevel }) => [engine, historyLevel]),
    ).toEqual([
      ["full", "full"],
      ["none", "none"],
    ])
  })

  describe.each(C7_STATUS_ENGINE.engines.map((recorded) => [recorded.engine, recorded] as const))(
    "the engine at history level %s",
    (_name, recorded) => {
      const { cli, status, verdict, health, atEdges } = expectedOf(recorded)

      it("pulse status states what engine_status states", () => {
        expect(statedByBoth(cli)).toEqual(statedByBoth(status))
        expect(cli.findings.every(({ next }) => typeof next === "string")).toBe(true)
      })

      it("the verdict feed and the overview's health judge as engine_status, the outside count apart", () => {
        expect(verdict).toEqual({
          status: health.status,
          outsideAnyProcess: health.summary.outsideAnyProcess,
        })
        expect(verdict).toEqual({
          status: status.status,
          outsideAnyProcess: status.outsideAnyProcess,
        })
      })

      it("the health sums the processes' root incidents, runs and versions the definitions count", () => {
        const { summary } = health
        expect(summary.totalIncidents).toBe(sum(status.definitions, (row) => row.incidents))
        expect(status.rootIncidentsTotal).toBe(
          summary.totalIncidents + status.outsideAnyProcess.count,
        )
        expect(summary.runningInstances).toBe(sum(status.definitions, (row) => row.instances))
        expect(summary.totalDefinitions).toBe(status.definitions.length)
        expect(summary.affectedDefinitions).toBe(
          status.definitions.filter((row) => row.incidents > 0).length,
        )
      })

      it("the health's last hour, activities and causes count the processes' root incidents alone", () => {
        const { summary, clusters } = health
        const hourAgo = Date.parse(C7_STATUS_ENGINE.asOf) - HOUR_MS
        const recent = status.incidents.filter(
          ({ firstAt }) => (engineDateMillis(firstAt) ?? Number.NaN) >= hourAgo,
        )
        expect(summary.lastHourIncidents).toBe(recent.reduce((total, row) => total + row.count, 0))
        expect(summary.lastHourIncidents).toBe(summary.totalIncidents)
        const elements = new Set(
          status.incidents.map(({ activityId }) => elementOfActivity(activityId)),
        )
        expect(summary.affectedActivities).toBe(elements.size)
        expect(clusters.reduce((total, row) => total + (row.incidentCount ?? 0), 0)).toBe(
          summary.totalIncidents,
        )
        expect(
          clusters.flatMap(({ processDefinitionKeys }) => processDefinitionKeys).sort(),
        ).toEqual(
          status.definitions
            .filter((row) => row.incidents > 0)
            .map(({ key }) => key)
            .sort(),
        )
      })

      it("every surface turns at the world's edge: critical at its root incidents, warning one above", () => {
        const [atRoots, aboveRoots] = atEdges
        expect(atEdges).toHaveLength(2)
        expect(atRoots).toEqual({
          criticalIncidents: status.rootIncidentsTotal,
          verdict: { status: "critical", outsideAnyProcess: status.outsideAnyProcess },
          engineStatus: "critical",
          health: "critical",
        })
        expect(aboveRoots).toEqual({
          criticalIncidents: status.rootIncidentsTotal + 1,
          verdict: { status: "warning", outsideAnyProcess: status.outsideAnyProcess },
          engineStatus: "warning",
          health: "warning",
        })
      })

      it("reads each of the world's cases as seeded", () => {
        const { processes, multiInstanceElement, items } = C7_STATUS_WORLD
        const incidentsOf = (key: string) =>
          status.definitions.find((row) => row.key === key)?.incidents
        // The batch's incident, which no definition counts, read whole.
        expect(status.outsideAnyProcess).toEqual({ count: 1, atLeast: false })
        // The chain's root incident counts in the label alone; its copy at the call activity in none.
        expect(incidentsOf(processes.label)).toBe(1)
        expect(incidentsOf(processes.dispatch)).toBe(0)
        expect(status.propagated).toBe(1)
        expect(status.incidentsTotal).toBe(status.rootIncidentsTotal + status.propagated)
        // The multi-instance body's root incident, grouped by the body's own id, beside the items.
        expect(incidentsOf(processes.approval)).toBe(1)
        expect(status.incidents.map(({ activityId }) => activityId)).toContain(
          `${multiInstanceElement}#multiInstanceBody`,
        )
        expect(status.tasks.open).toBe(items)
        expect(status.status).toBe("warning")
      })
    },
  )

  it("counts the history only where the engine writes one, everything else alike", () => {
    const [full, none] = C7_STATUS_ENGINE.engines.map(expectedOf)
    expect(full?.health.summary).toMatchObject({ historyRecorded: true, completed24h: 0 })
    expect(full?.health.summary.started24h).toBeGreaterThan(0)
    expect(none?.health.summary).toMatchObject({
      historyRecorded: false,
      started24h: null,
      completed24h: null,
    })
    const figures = (expected: ReturnType<typeof expectedOf> | undefined) => ({
      ...statedByBoth(expected?.status ?? ({} as Status)),
      findings: expected?.status.findings.map(({ code, severity }) => ({ code, severity })),
      incidents: expected?.status.incidents.map(({ activityId, count }) => ({ activityId, count })),
      verdict: expected?.verdict,
      atEdges: expected?.atEdges,
    })
    expect(figures(none)).toEqual(figures(full))
  })
})
