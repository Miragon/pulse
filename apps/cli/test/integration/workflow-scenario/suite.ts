/** What the steps of the workflow scenario (workflow-scenario.ts) share, and the outputs they read. */

import type { Cli } from "../support/cli.js"

interface Definition {
  readonly type: string
  readonly key: string
  readonly version: number
}

export interface DeployOutput {
  readonly deploymentId: string
  readonly changed: boolean
  readonly resources: readonly {
    readonly resource: string
    readonly status: string
    readonly definitions: readonly Definition[]
  }[]
  readonly instance?: InstanceOutput
}

interface WaitState {
  readonly activityId: string
  readonly kind: string
  readonly activityType?: string
  readonly processInstanceId?: string
  readonly taskId?: string
  readonly suspended?: boolean
}

export interface InstanceOutput {
  readonly id: string
  readonly state: string
  readonly waitingAt: readonly WaitState[]
  readonly incidents: readonly {
    readonly type: string
    readonly activityId: string
    readonly rootCause?: string
  }[]
  readonly children: readonly { readonly id: string; readonly key: string }[]
  readonly timeline?: readonly { readonly activityId: string }[]
  readonly next?: readonly string[]
}

export interface StatusOutput {
  readonly findings: readonly { code: string; message: string; next?: string }[]
  readonly externalTasks: readonly { topic: string; waiting: number; lockExpired: number }[]
}

export interface AdvanceOutput {
  readonly advanced: {
    readonly activityId: string
    readonly kind: string
    readonly via: readonly string[]
  }
  readonly instance?: InstanceOutput
}

const BUSINESS_KEY = "WF-1"
export const BY_KEY = ["--business-key", BUSINESS_KEY]

export interface WorkflowScenario {
  /** Runs the built CLI against the engine (bound once the engine has started). */
  readonly cli: Cli
  /** The suite's temporary directory, and the directory with the workflow fixture in it. */
  readonly workdir: () => string
  readonly bpmnDir: () => string
  /** The deployment and the instance the scenario works on, for the steps after the first. */
  readonly state: { deploymentId?: string; instanceId?: string }
  /** `inspect` of the instance by its business key, with the extra arguments. */
  readonly inspect: (...extra: string[]) => Promise<InstanceOutput>
}
