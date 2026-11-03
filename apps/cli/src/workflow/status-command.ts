/**
 * `pulse-cli status`: engine triage in one call, @miragon/pulse-engine-core's `readStatus` with the
 * engine address (masked) and the next steps as command lines; `--fail-on` turns the status into
 * CHECK_FAILED.
 */

import * as core from "@miragon/pulse-engine-core"
import type { EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { maskUrl } from "../output/secrets.js"
import { compact } from "../util.js"
import { checkFailure } from "./findings.js"
import { findingCommand, groupCommand } from "./next-text.js"
import type { WorkflowResult } from "./types.js"

type IncidentGroup = core.IncidentGroup<string>
/** A finding as `pulse-cli status` prints it: its next step as a command line. */
type Finding = Omit<core.Finding<string>, "next"> & { readonly next?: string }

export interface StatusOptions extends core.StatusOptions {
  readonly failOn?: core.Severity
  readonly dryRun: boolean
  /** The REST root and engine name, shown masked unless `showSecrets`. */
  readonly engine: {
    readonly url: string
    readonly engine?: string
    readonly showSecrets: boolean
  }
}

export interface StatusView extends Omit<core.StatusData, "engine" | "findings" | "incidents"> {
  readonly engine: {
    readonly url: string
    readonly engine?: string
    readonly version: string | null
    readonly latencyMs: number
  }
  readonly findings: readonly Finding[]
  readonly incidents: readonly IncidentGroup[]
}

export interface StatusDeps {
  readonly port: EnginePort
  readonly now: () => number
}

/** Equal incident groups in the order of their command lines. */
export function groupOrder(left: core.GroupStep, right: core.GroupStep): number {
  return core.compareText(groupCommand(left), groupCommand(right))
}

/** An incident group with its next step as a command line. */
export function renderGroup<G extends core.IncidentGroup>(
  group: G,
): Omit<G, "next"> & { readonly next: string } {
  return { ...group, next: groupCommand(group.next) }
}

/** A finding with its next step as a command line. */
export function renderFinding(finding: core.Finding): core.Finding<string> {
  return { ...finding, next: findingCommand(finding.next) }
}

/** The requests of round 1, as `--dry-run` previews them (lists with their first page). */
export function statusRequests(options: StatusOptions, now: number): PlannedRequest[] {
  return core.statusRequests(options, now)
}

export async function status(
  deps: StatusDeps,
  options: StatusOptions,
): Promise<WorkflowResult<StatusView>> {
  if (options.dryRun) return { kind: "dry-run", requests: statusRequests(options, deps.now()) }
  const data = await core.readStatus(deps, { ...options, compareGroupSteps: groupOrder })
  const findings = data.findings.map(renderFinding)
  const view: StatusView = {
    ...data,
    engine: {
      url: maskUrl(options.engine.url, options.engine.showSecrets),
      ...compact({ engine: options.engine.engine }),
      ...data.engine,
    },
    findings,
    incidents: data.incidents.map(renderGroup),
  }
  return {
    kind: "view",
    view,
    ...compact({ failure: checkFailure(data.status, findings, options.failOn) }),
  }
}
