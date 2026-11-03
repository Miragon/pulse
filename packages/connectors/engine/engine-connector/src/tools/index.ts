import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"

import { registerProcessDefinitionTools } from "./process-definitions.js"
import { registerProcessInstanceTools } from "./process-instances.js"
import { registerTaskTools } from "./tasks.js"
import { registerTaskFormTools } from "./task-form.js"
import { registerExternalTaskTools } from "./external-tasks.js"
import { registerMessageSignalTools } from "./messages-signals.js"
import { registerDeploymentTools } from "./deployments.js"
import { registerIncidentTools } from "./incidents.js"
import { registerJobTools } from "./jobs.js"
import { registerHistoryTools } from "./history.js"
import { registerMigrationTools } from "./migrations.js"
import { registerBatchTools } from "./batches.js"

export interface RegisterToolsOptions {
  /** `ENGINE_ALLOW_DEPLOYMENTS=true`: deploying runs code inside the engine JVM. */
  allowDeployments?: boolean
}

export function registerTools(
  register: ToolRegistrar<EngineRegistry>,
  opts: RegisterToolsOptions = {},
): void {
  registerProcessDefinitionTools(register)
  registerProcessInstanceTools(register)
  registerTaskTools(register)
  registerTaskFormTools(register)
  registerExternalTaskTools(register)
  registerMessageSignalTools(register)
  registerDeploymentTools(register, { allowDeployments: opts.allowDeployments === true })
  registerIncidentTools(register)
  registerJobTools(register)
  registerHistoryTools(register)
  registerMigrationTools(register)
  registerBatchTools(register)
}
