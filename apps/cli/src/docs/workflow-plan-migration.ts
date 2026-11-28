/**
 * `pulse plan-migration`, the entry of WORKFLOW_DOCS (workflow.ts) for the plan file: its
 * arguments, its options and its docs. Pure.
 */

import type { ArgumentDoc, OptionDoc } from "./options.js"
import type { WorkflowDoc } from "./workflow-doc.js"
import { option } from "./workflow-options.js"

const PLAN_MIGRATION_ARGUMENTS: readonly ArgumentDoc[] = [
  {
    name: "key",
    required: true,
    variadic: false,
    description: "The process definition key, the BPMN process id the plan names",
  },
  {
    name: "source",
    required: true,
    variadic: false,
    description: "The version number the instances run on",
  },
  {
    name: "target",
    required: false,
    variadic: false,
    description: "The version number they would move to (default: the latest)",
  },
]

const PLAN_MIGRATION_OPTIONS: readonly OptionDoc[] = [
  option(
    "map",
    "repeatable",
    "Map the element <source> of the source version onto the element <target> of the target version, replacing the engine's mapping of <source> or adding one; comma lists split",
    { valueName: "<source>=<target>" },
  ),
  option(
    "unmap",
    "repeatable",
    "Leave out the engine's mapping of the element <source>; comma lists split",
    { valueName: "<source>" },
  ),
  option(
    "plan-file",
    "value",
    "Where to write the plan, a path ending in .migration.json (default .pulse/migrations/<key>-v<source>-to-v<target>.migration.json)",
    { valueName: "<path>" },
  ),
  option(
    "replace",
    "presence",
    "Replace a plan file already there (edits made in it are lost); without it the command refuses one",
  ),
]

export const PLAN_MIGRATION_DOC: WorkflowDoc = {
  name: "plan-migration",
  usage: "pulse plan-migration <key> <source> [target] [options]",
  summary:
    "Write a migration plan between two versions of a process as a file Pulse for VS Code edits",
  description:
    "Asks the engine for its mapping between two versions of a process (the target defaults to the latest version), applies --unmap and --map, has the engine check the result and writes it as a plan file keyed by the process definition key and the two version numbers, with no engine, no definition id and no instance in it (.pulse/migrations/<key>-v<source>-to-v<target>.migration.json unless --plan-file names one), and replaces a file there only with --replace. Pulse for VS Code edits the file in diagrams of both versions, checked on an engine you pick. The command migrates nothing; when the engine finds problems it still writes the file and exits with code 9 (CHECK_FAILED).",
  requests:
    "in parallel GET /process-definition?key=&version= for each version (latestVersion=true without a target version; each must name exactly one definition), then POST /migration/generate (updateEventTriggers false), then POST /migration/validate with your changes (one instruction per mapping, updateEventTrigger false)",
  effect: "read",
  effectNote:
    "writes the plan file; nothing changes on the engine; --dry-run sends nothing, writes nothing and names the file in its plan when the target version or --plan-file is given",
  arguments: PLAN_MIGRATION_ARGUMENTS,
  options: PLAN_MIGRATION_OPTIONS,
  calls: ["getProcessDefinitions", "generateMigrationPlan", "validateMigrationPlan"],
  examples: [
    "pulse plan-migration invoice 1 2",
    "pulse plan-migration order-fulfillment 3 --map Activity_CheckOrder=Activity_ReviewOrder --unmap Activity_Notify",
    "pulse plan-migration invoice 1 2 --plan-file plans/invoice.migration.json --dry-run",
  ],
}
