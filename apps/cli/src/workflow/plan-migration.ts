/**
 * `pulse plan-migration`: the engine's mapping between two versions of a process, changed by
 * `--map` and `--unmap` and checked by the engine, written as a plan file of
 * @miragon/pulse-migration-plan, keyed by the process definition key and the two version numbers.
 * Only reads go to the engine, through c7-core's migration planning rules; the definition ids and
 * the engine's words stay in the view, never in the file. Engine problems still write the file,
 * then CHECK_FAILED. A file already there is replaced only with --replace; `--dry-run` names the
 * file it would write when the target version or --plan-file is given.
 */

import * as core from "@miragon/pulse-c7-core"
import {
  MigrationPlanFiles,
  MigrationPlanProblems,
  MigrationPlanRules,
  MigrationPlanText,
  MigrationPlanVersions,
  MigrationPlanVocabulary,
  type VersionPick,
} from "@miragon/pulse-migration-plan"
import type { EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { PulseCliError, usageError } from "../errors.js"
import type { FileSystem } from "../runtime.js"
import { renderedAsync } from "./error-text.js"
import { plural } from "./findings.js"
import { checkPlanTarget, writePlanFile } from "./plan-migration-file.js"
import {
  applyEdits,
  type PlanEdits,
  type PlannedMapping,
  parseEdits,
  usablePairs,
} from "./plan-migration-mappings.js"
import type { WorkflowResult } from "./types.js"

export interface PlanMigrationOptions {
  readonly key: string
  readonly source: number
  /** Without it, the latest version. */
  readonly target?: number
  readonly map: readonly string[]
  readonly unmap: readonly string[]
  /** Without it, `.pulse/migrations/<key>-v<source>-to-v<target>.migration.json`. */
  readonly planFile?: string
  /** `--replace`: a plan file already there is replaced, else the command refuses it. */
  readonly replace: boolean
  readonly dryRun: boolean
}

export interface PlanMigrationDeps {
  readonly port: EnginePort
  readonly fs: FileSystem
}

/** A version of the plan and the definition that has it on this engine. */
interface PlanSideView {
  readonly version: number
  readonly definitionId: string
}

/** What the engine finds wrong with the plan, with its mapping where it names one. */
interface PlanProblemView {
  readonly sourceElementId?: string
  readonly targetElementId?: string
  readonly message: string
}

export interface PlanMigrationView {
  readonly planFile: string
  /** The file was there and is replaced (`--replace`). */
  readonly replaced: boolean
  readonly bpmnProcessId: string
  readonly source: PlanSideView
  readonly target: PlanSideView
  readonly mappings: readonly PlannedMapping[]
  /** Instructions of the engine's proposal a plan file cannot hold (not one to one). */
  readonly leftOut: number
  readonly problems: readonly PlanProblemView[]
}

type Definition = core.DefinitionAtVersion

function versionsHint(key: string): string {
  return `List the versions with: pulse process-definition list --key ${key}`
}

/** `<source> "0" must be a version number from 1 to 2147483647`, the version as typed. */
export function notAVersion(typed: string, name: string, key: string): PulseCliError {
  const rule = MigrationPlanProblems.describe({ path: name, code: "notAVersion" })
  return usageError(`<${name}> "${typed}" ${rule}`, versionsHint(key))
}

function checkVersion(version: number, name: string, key: string): void {
  if (MigrationPlanRules.isVersion(version)) return
  throw notAVersion(String(version), name, key)
}

/** The key's rule, checked first, so a version's hint never names a key that is no process id. */
export function checkKey(key: string): void {
  if (MigrationPlanRules.isProcessId(key)) return
  const rule = MigrationPlanProblems.describe({ path: "key", code: "notAProcessId" })
  throw usageError(
    `<key> ${JSON.stringify(key)} ${rule}`,
    "Pass the process definition key, not a definition id; pulse process-definition list lists them.",
  )
}

/** The checks of the command line, before any request, and the edits it names. */
function checkedInput(options: PlanMigrationOptions): PlanEdits {
  const { key, source, target, planFile } = options
  checkKey(key)
  checkVersion(source, "source", key)
  if (target !== undefined) checkVersion(target, "target", key)
  if (target === source) {
    throw usageError(
      `<source> and <target> are both version ${String(source)}`,
      "Name the version to migrate to, or leave <target> out for the latest.",
    )
  }
  if (planFile !== undefined && !MigrationPlanFiles.isPlanPath(planFile)) {
    const suffix = MigrationPlanFiles.SUFFIX
    throw usageError(
      `--plan-file ${planFile} must end in ${suffix}`,
      `Pulse for VS Code edits files ending in ${suffix}, e.g. --plan-file plans/${key}${suffix}.`,
    )
  }
  return parseEdits(options.map, options.unmap)
}

/** `invoice has 2 ...`: several definitions at one number, one per tenant; a plan names none. */
function ambiguous(
  key: string,
  version: core.VersionQuery,
  found: core.DefinitionsAtVersion,
): PulseCliError {
  const shown = found.definitions.length
  const count = found.more ? `more than ${String(shown)}` : String(shown)
  const tenants = found.definitions.map((definition) => definition.tenantId ?? "no tenant")
  if (version === "latest") {
    return usageError(
      `${key} has ${count} latest versions on this engine, one per tenant (${tenants.join(", ")}); a plan names no tenant`,
      `Name the target version, one that exists once on this engine: pulse plan-migration ${key} <source> <target>`,
    )
  }
  return usageError(
    `Version ${String(version)} of ${key} is deployed ${count} times on this engine (tenants: ${tenants.join(", ")}); a plan names no tenant`,
    "Name versions that exist once on this engine.",
  )
}

/** The one definition of `key` at `version`: none is NOT_FOUND, several (tenants) are USAGE. */
function onlyDefinition(
  key: string,
  version: core.VersionQuery,
  found: core.DefinitionsAtVersion,
): Definition {
  const pick: VersionPick<Definition> =
    version === "latest"
      ? MigrationPlanVersions.only(found.definitions)
      : MigrationPlanVersions.pick(found.definitions, version)
  if (pick.kind === "found") return pick.candidate
  if (pick.kind === "ambiguous") throw ambiguous(key, version, found)
  const missing = version === "latest" ? "no latest version" : `no version ${String(version)}`
  throw new PulseCliError("NOT_FOUND", `${key} has ${missing} on this engine`, {
    hint: versionsHint(key),
  })
}

/** The source and the target definition, looked up in parallel; the source's failure first. */
async function definitions(
  port: EnginePort,
  options: PlanMigrationOptions,
): Promise<readonly [Definition, Definition]> {
  const { key } = options
  const targetVersion = options.target ?? "latest"
  const [sources, targets] = await Promise.all([
    renderedAsync(core.definitionsAtVersion(port, key, options.source)),
    renderedAsync(core.definitionsAtVersion(port, key, targetVersion)),
  ])
  const source = onlyDefinition(key, options.source, sources)
  const target = onlyDefinition(key, targetVersion, targets)
  if (target.version === source.version) {
    throw usageError(
      `v${String(source.version)} is the latest version of ${key} on this engine`,
      `Name the version to migrate to: pulse plan-migration ${key} ${String(source.version)} <target>`,
    )
  }
  return [source, target]
}

/** The two lookups `--dry-run` previews; nothing is sent and nothing is written. */
function lookupRequests(options: PlanMigrationOptions): PlannedRequest[] {
  return [
    core.definitionsAtVersionRequest(options.key, options.source),
    core.definitionsAtVersionRequest(options.key, options.target ?? "latest"),
  ]
}

/**
 * The write `--dry-run` names (its `plan`): the plan file, checked as the command checks it but for
 * --replace, and whether a file is there; both null while the latest version, which only the
 * engine names, decides the default file name.
 */
interface PlanFileWrite {
  readonly planFile: string | null
  readonly exists: boolean | null
}

/** The plan file the command line names: `--plan-file`, else the default path of two versions. */
function namedPlanFile(options: PlanMigrationOptions) {
  if (options.planFile !== undefined) return { path: options.planFile, isDefault: false }
  if (options.target === undefined) return undefined
  const name = {
    bpmnProcessId: options.key,
    source: { version: options.source },
    target: { version: options.target },
  }
  return { path: MigrationPlanFiles.pathOf(name), isDefault: true }
}

/** `--dry-run`: the two lookups and the write, checked; nothing is sent and nothing is written. */
async function dryRun(
  fs: FileSystem,
  options: PlanMigrationOptions,
): Promise<WorkflowResult<PlanMigrationView>> {
  const named = namedPlanFile(options)
  const plan: PlanFileWrite =
    named === undefined
      ? { planFile: null, exists: null }
      : { planFile: named.path, exists: await checkPlanTarget(fs, { ...named, replace: true }) }
  return { kind: "dry-run", plan, requests: lookupRequests(options) }
}

/** The proposal with the edits applied, and how many of its instructions a plan cannot hold. */
async function plannedMappings(
  port: EnginePort,
  sides: readonly [Definition, Definition],
  edits: PlanEdits,
): Promise<{ readonly mappings: PlannedMapping[]; readonly leftOut: number }> {
  const [source, target] = sides
  const proposal = await renderedAsync(core.proposeMigrationPlan(port, source.id, target.id))
  const usable = usablePairs(proposal.mappings)
  const mappings = applyEdits(usable.pairs, edits)
  const max = MigrationPlanVocabulary.MAX_MAPPINGS
  if (mappings.length > max) {
    throw usageError(
      `The plan has ${String(mappings.length)} mappings; a plan file holds at most ${String(max)}`,
      "Leave mappings out with --unmap.",
    )
  }
  return { mappings, leftOut: proposal.leftOut + usable.unusable }
}

function problemView(problem: core.PlanCheckProblem): PlanProblemView {
  return problem.mapping === undefined
    ? { message: problem.message }
    : { ...problem.mapping, message: problem.message }
}

function checkFailure(problems: readonly PlanProblemView[]): PulseCliError | undefined {
  if (problems.length === 0) return undefined
  return new PulseCliError(
    "CHECK_FAILED",
    `The engine finds ${plural(problems.length, "problem")} in the plan`,
    {
      hint: "Change the mapping with --map or --unmap and run the command again, or edit the file.",
    },
  )
}

export async function planMigration(
  deps: PlanMigrationDeps,
  options: PlanMigrationOptions,
): Promise<WorkflowResult<PlanMigrationView>> {
  const edits = checkedInput(options)
  if (options.dryRun) return dryRun(deps.fs, options)
  const { replace } = options
  if (options.planFile !== undefined) {
    await checkPlanTarget(deps.fs, { path: options.planFile, isDefault: false, replace })
  }
  const [source, target] = await definitions(deps.port, options)
  const name = {
    bpmnProcessId: options.key,
    source: { version: source.version },
    target: { version: target.version },
  }
  const planFile = options.planFile ?? MigrationPlanFiles.pathOf(name)
  const file = { path: planFile, isDefault: options.planFile === undefined, replace }
  if (file.isDefault) await checkPlanTarget(deps.fs, file)
  const { mappings, leftOut } = await plannedMappings(deps.port, [source, target], edits)
  const plan = { sourceDefinitionId: source.id, targetDefinitionId: target.id, mappings }
  const found = await renderedAsync(core.checkMigrationPlan(deps.port, plan))
  const text = MigrationPlanText.of({ ...name, mappings })
  const replaced = await writePlanFile(deps.fs, file, text)
  const problems = found.map(problemView)
  const view: PlanMigrationView = {
    planFile,
    replaced,
    bpmnProcessId: options.key,
    source: { version: source.version, definitionId: source.id },
    target: { version: target.version, definitionId: target.id },
    mappings,
    leftOut,
    problems,
  }
  const failure = checkFailure(problems)
  return failure === undefined ? { kind: "view", view } : { kind: "view", view, failure }
}
