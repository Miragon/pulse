/**
 * A process's numbers on a real engine (#665), the checks c7-runtime.engine.test.ts runs on its
 * seeded world: `engine_process_stats` counts per bucket what the history holds, read whole as a
 * page would count it, with the median and P90 at their ranks, and counts now what the cockpit's
 * process detail counts; `engine_activity_counts` are the cockpit's element counts ("Running"),
 * with the open tasks the engine holds, and the copy at the dispatch's call activity worded by the
 * label's root incident. Each check compares with reads of the same moment, so the suite's other
 * cases may start or end instances around it.
 */

import { engineDateMillis, toEngineDate } from "@miragon/pulse-c7-core"
import { WORLD_ELEMENT, WORLD_PROCESS } from "@miragon/pulse-engine-core/testing"
import { expect } from "vitest"
import { buildActivityCountsData } from "../../data/activity-counts-data.js"
import { buildActivityStatisticsData } from "../../data/activity-statistics-data.js"
import { buildProcessInstancesData } from "../../data/cockpit-data.js"
import { buildProcessIncidentsData } from "../../data/process-incidents-data.js"
import { buildProcessStatsData } from "../../data/process-stats-floor.js"
import type { ResolvedEngine } from "../engine/resolve-engine.js"

/** What the history's instance rows hold that a page counts per bucket. */
interface HistoricRow {
  readonly id: string
  readonly startTime: string | null
  readonly endTime: string | null
  readonly durationInMillis: number | null
}

/** An activity's figures as the cockpit's "Running" and `engine_activity_counts` give them. */
interface ElementFigures {
  readonly activityId: string
  readonly running: number
  readonly incidents: number
  readonly incidentsInCalledInstances: number
  readonly failedJobs: number
}

/** The JSON answer of a read the check sends itself, over the REST API without the SDK. */
async function read<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

async function statsCountWhatTheHistoryHolds(url: string, engine: ResolvedEngine): Promise<void> {
  const key = WORLD_PROCESS.order
  const stats = await buildProcessStatsData(engine.client, engine.engineId, {
    processDefinitionKey: key,
    bucket: "hour",
  })
  const [detail, instances, tasks] = await Promise.all([
    buildProcessIncidentsData(engine.client, {
      baseUrl: url,
      provider: engine.provider,
      processDefinitionKey: key,
    }),
    buildProcessInstancesData(engine.client, engine.engineId, { processDefinitionKey: key }),
    read<{ count: number }>(`${url}/task/count?processDefinitionKey=${key}`),
  ])
  expect(stats.now).toMatchObject({
    running: detail.runningInstances,
    incidents: detail.incidentCount,
    failedJobs: detail.failedJobs,
    withIncident: instances.withIncidentCount,
    openTasks: tasks.count,
  })
  const bound = (iso: string, shift = 0) =>
    encodeURIComponent(toEngineDate(new Date(Date.parse(iso) + shift)))
  const rowsIn = (event: "started" | "finished") =>
    read<HistoricRow[]>(
      `${url}/history/process-instance?processDefinitionKey=${key}&maxResults=1000` +
        `&${event}After=${bound(stats.range.from)}&${event}Before=${bound(stats.range.to, -1)}`,
    )
  const [started, ended] = await Promise.all([rowsIn("started"), rowsIn("finished")])
  const perBucket = (rows: readonly HistoricRow[], at: (row: HistoricRow) => string | null) =>
    stats.buckets.map(({ start, end }) => {
      const inBucket = (ms: number) => ms >= Date.parse(start) && ms < Date.parse(end)
      return rows.filter((row) => inBucket(engineDateMillis(at(row)) ?? -1)).length
    })
  expect(stats.buckets.map((bucket) => bucket.started)).toEqual(
    perBucket(started, (row) => row.startTime),
  )
  expect(stats.buckets.map((bucket) => bucket.ended)).toEqual(
    perBucket(ended, (row) => row.endTime),
  )
  // The world ends its express order at once: some ended, the median and P90 at their ranks.
  expect(ended.length).toBeGreaterThan(0)
  const durations = ended.map((row) => row.durationInMillis ?? 0).sort((a, b) => a - b)
  const rank = (q: number) => durations[Math.max(1, Math.ceil(q * durations.length)) - 1]
  expect(stats.durations).toMatchObject({
    ended: ended.length,
    medianMs: rank(0.5),
    p90Ms: rank(0.9),
  })
  const express = WORLD_ELEMENT.shippedExpress
  const reached = await read<{ processInstanceId: string }[]>(
    `${url}/history/activity-instance?activityId=${express}&maxResults=1000`,
  )
  const endedIds = new Set(ended.map((row) => row.id))
  const event = stats.endEvents.find(({ activityId }) => activityId === express)
  expect(event?.ended).toBe(reached.filter((row) => endedIds.has(row.processInstanceId)).length)
}

const figuresOf = (rows: readonly ElementFigures[]) =>
  rows.map(({ activityId, running, incidents, incidentsInCalledInstances, failedJobs }) => ({
    activityId,
    running,
    incidents,
    incidentsInCalledInstances,
    failedJobs,
  }))

async function countsAreTheCockpits(url: string, engine: ResolvedEngine): Promise<void> {
  for (const key of [WORLD_PROCESS.order, WORLD_PROCESS.dispatch]) {
    const [counts, running, tasks] = await Promise.all([
      buildActivityCountsData(engine.client, engine.engineId, { processDefinitionKey: key }),
      buildActivityStatisticsData(engine.client, { processDefinitionKey: key, source: "runtime" }),
      read<{ taskDefinitionKey: string }[]>(`${url}/task?processDefinitionKey=${key}`),
    ])
    const cockpit = (running as { activities: ElementFigures[] }).activities
    expect(figuresOf(counts.activities), key).toEqual(figuresOf(cockpit))
    const byTask = new Map<string, number>()
    for (const { taskDefinitionKey } of tasks) {
      byTask.set(taskDefinitionKey, (byTask.get(taskDefinitionKey) ?? 0) + 1)
    }
    const counted = counts.activities.filter((row) => row.openTasks > 0)
    expect(new Map(counted.map((row) => [row.activityId, row.openTasks])), key).toEqual(byTask)
  }
  // The dispatch waits at the label it called: Camunda 7 copies the label's incident there.
  const dispatch = await buildActivityCountsData(engine.client, engine.engineId, {
    processDefinitionKey: WORLD_PROCESS.dispatch,
  })
  const callActivity = WORLD_ELEMENT.printShippingLabel
  const [root] = await read<{ incidentMessage: string | null }[]>(
    `${url}/incident?processDefinitionKeyIn=${WORLD_PROCESS.label}`,
  )
  const call = dispatch.activities.find(({ activityId }) => activityId === callActivity)
  expect(call).toMatchObject({ incidents: 0, incidentsInCalledInstances: 1 })
  expect(call?.latestIncidentInCalledInstances?.message).toBe(root?.incidentMessage)
  const decoration = dispatch.decorations.find(({ elementId }) => elementId === callActivity)
  expect(decoration).toMatchObject({ incident: false })
  const first = await buildActivityCountsData(engine.client, engine.engineId, {
    processDefinitionKey: WORLD_PROCESS.order,
    version: 1,
  })
  expect(first).toMatchObject({ version: 1, versionsCounted: 1 })
}

/** Each check by its name, over the seeded engine at `url` as the server resolves it. */
export const PROCESS_NUMBER_CHECKS: ReadonlyArray<
  readonly [string, (url: string, engine: ResolvedEngine) => Promise<void>]
> = [
  [
    "numbers: engine_process_stats counts what the history holds and what the process detail counts",
    statsCountWhatTheHistoryHolds,
  ],
  [
    "numbers: engine_activity_counts are the cockpit's element counts, with the engine's open tasks",
    countsAreTheCockpits,
  ],
]
