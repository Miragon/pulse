/** What the steps of the scenario (scenario.ts) share: the engine, the CLI bound to it, the files. */

import type { Cli } from "../support/cli.js"
import type { EngineName } from "../support/engines.js"
import type { ExternalTask } from "../support/types.js"

export const WORKER_ID = "w1"

export interface Scenario {
  readonly engineName: EngineName
  /** Runs the built CLI against the engine (bound once the engine has started). */
  readonly cli: Cli
  readonly engineUrl: () => string
  /** The suite's temporary directory and its config file. */
  readonly workdir: () => string
  readonly configFile: () => string
  /** The order the flow started, for the steps after it. */
  readonly state: { orderId?: string }
  /** Starts an order with that business key; resolves to the instance id. */
  readonly startOrder: (businessKey: string, variables?: readonly string[]) => Promise<string>
  readonly countInstances: (filter: Readonly<Record<string, string>>) => Promise<number>
  readonly completeUserTask: (processInstanceId: string) => Promise<void>
  /** Locks the `charge-card` task of the instance with that business key. */
  readonly fetchAndLock: (businessKey: string, viaStdin?: boolean) => Promise<ExternalTask[]>
}
