import type { BoardFiles } from "../board-files.js"
import type { EngineToolRegistrar } from "../lib/engine/served-engines.js"

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
import { registerProcessNumberTools } from "./process-numbers.js"
import { registerScreenTools } from "./screens.js"

export interface RegisterToolsOptions {
  /** `ENGINE_ALLOW_DEPLOYMENTS=true`: deploying runs code inside the engine JVM. */
  allowDeployments?: boolean
  /** The boards of ENGINE_BOARDS_DIR, which the board tool builds; none without it. */
  boards?: BoardFiles
}

export function registerTools(
  register: EngineToolRegistrar,
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
  // A process's numbers ready to show (#665).
  registerProcessNumberTools(register)
  // The screens and boards as JSON (#666): their own block, every dialect.
  registerScreenTools(register, opts.boards)
}
