/**
 * What every surface shows of a root incident outside any process (owner decision of 2026-11-26),
 * on the seeded engine while contract-cases.test-support.ts holds the failed batch's incident open
 * (no version, element or instance): the definition statistics never count it, so the processes'
 * open root incidents are what they were before it; the verdict judges it, and `engine_status`
 * (c7-core's triage, the CLI's status too), the chat overview's health feed and the web app's
 * verdict feed each name it apart as one outside any process, read whole (the world holds fewer
 * incidents than any scan's cap).
 */

import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import { expect } from "vitest"
import { buildEngineHealthData } from "../../data/health-data.js"
import { buildEngineVerdictData } from "../../data/screens/verdict-data.js"
import type { ResolvedEngine } from "../engine/resolve-engine.js"
import { engineStatusForModel } from "./composites.js"

/** The open root incidents of every process, as the definition statistics count them. */
export async function processRoots(url: string): Promise<number> {
  const response = await fetch(`${url}/process-definition/statistics?rootIncidents=true`)
  if (!response.ok) throw new Error(`the statistics: HTTP ${response.status}`)
  const rows = (await response.json()) as { incidents: { incidentCount: number }[] }[]
  return rows
    .flatMap(({ incidents }) => incidents)
    .reduce((sum, { incidentCount }) => sum + incidentCount, 0)
}

/**
 * Every surface over the recorded board's engine, which `resolve` (a registry of the case's own,
 * so no floor of an earlier case answers) names, once the incident outside any process is raised;
 * `rootsBefore` the processes' open root incidents before it.
 */
export async function expectOutsideAnyProcessOnEverySurface(
  url: string,
  resolve: (name: string) => ResolvedEngine,
  rootsBefore: number,
): Promise<void> {
  const engine = resolve(C7_BOARD_ENGINE.engine)
  const one = { count: 1, atLeast: false }
  expect(await processRoots(url)).toBe(rootsBefore)
  const [status, health, verdict] = await Promise.all([
    engineStatusForModel(engine.client, {}, engine.engineId, DEFAULT_VERDICT_THRESHOLDS),
    buildEngineHealthData(engine.client, engine.engineId),
    buildEngineVerdictData(engine, DEFAULT_VERDICT_THRESHOLDS),
  ])
  // engine_status judges it with the processes' and names it apart.
  expect(status).toMatchObject({ rootIncidentsTotal: rootsBefore + 1, outsideAnyProcess: one })
  expect(status.status).not.toBe("ok")
  // The chat's overview: the processes' count stays theirs, the line of its own beside it.
  expect(health.summary).toMatchObject({ totalIncidents: rootsBefore, outsideAnyProcess: one })
  expect(health.status).not.toBe("ok")
  // The web app's verdict feed: the overview's verdict, and the count for the page's line.
  expect(verdict).toEqual({ status: health.status, outsideAnyProcess: one })
}
