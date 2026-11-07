import type { BulkRun } from "../panels/bulk-run.js"
import type { MigrationState } from "../panels/migration-reads.js"
import type {
  EngineBadge,
  MigrateOffer,
  MigrationView,
  Notice,
  VersionOption,
} from "../protocol/index.js"
import { BulkOutcomes } from "./bulk-outcomes.js"
import { Labels } from "./labels.js"
import { MigrationRows } from "./migration-rows.js"

export interface MigrationScene {
  readonly engine: EngineBadge
  readonly now: number
  readonly canWrite: boolean
  readonly run: BulkRun | undefined
}

export class MigrationViewBuilder {
  private readonly rows: MigrationRows

  constructor(
    private readonly state: MigrationState,
    private readonly scene: MigrationScene,
  ) {
    this.rows = new MigrationRows(state)
  }

  build(): MigrationView {
    const { state } = this
    const { run } = this.scene
    return {
      kind: "migration",
      engine: this.scene.engine,
      asOf: state.asOf.toISOString(),
      processName: state.source.name ?? state.source.bpmnProcessId,
      bpmnProcessId: state.source.bpmnProcessId,
      source: {
        definitionId: state.source.id,
        version: state.source.version,
        diagramXml: state.sourceXml,
      },
      ...(state.target === undefined || state.targetXml === undefined
        ? {}
        : {
            target: {
              definitionId: state.target.id,
              version: state.target.version,
              diagramXml: state.targetXml,
            },
          }),
      targets: this.targetOptions(),
      latestVersion: state.versions[0]?.definition.version ?? state.source.version,
      rows: this.rows.rows(),
      ...(state.focused === undefined ? {} : { focused: state.focused }),
      count: this.rows.count,
      summary: this.summary(),
      offer: this.offer(),
      notices: this.notices(),
      ...(run === undefined
        ? {}
        : {
            bulk: new BulkOutcomes(run, {
              now: this.scene.now,
              environment: this.scene.engine.environment,
              shownVersion: state.source.version,
              canWrite: this.scene.canWrite,
              selectsRemaining: false,
            }).view(),
          }),
    }
  }

  private targetOptions(): VersionOption[] {
    return this.state.versions
      .filter((version) => version.definition.id !== this.state.source.id)
      .map((version) => ({
        definitionId: version.definition.id,
        version: version.definition.version,
        running: version.running,
        withIncident: version.withIncident,
      }))
  }

  private summary(): string {
    const { mappings, problems, checking, target } = this.state
    if (target === undefined) {
      return `${Labels.plural(this.rows.count, "instance")} on v${this.state.source.version}`
    }
    const checked = checking ? "checking…" : "checked just now"
    if (this.rows.identical() && problems.length === 0) {
      return `All ${Labels.plural(mappings.length, "element")} map by id · no problems · ${checked}`
    }
    return `${mappings.length} mapped · ${this.findings()} · ${checked}`
  }

  private findings(): string {
    const { problems } = this.state
    const unmapped = this.rows.blocked().labels.length
    if (problems.length > 0) {
      return Labels.plural(problems.length, "problem")
    }
    return unmapped === 0 ? "no problems" : `${unmapped} without a mapping`
  }

  private offer(): MigrateOffer {
    const { target, checking, checkFailure, problems } = this.state
    const label = `Migrate ${Labels.plural(this.rows.count, "instance")}…`
    if (target === undefined) {
      return { status: "pickTarget", reason: "Pick the version to migrate to." }
    }
    const blockedBy = this.activeRun()
    if (blockedBy !== undefined) {
      return { status: "refused", reason: blockedBy }
    }
    if (this.rows.count === 0) {
      return {
        status: "refused",
        reason: `None of the selected instances runs on v${this.state.source.version} any more.`,
      }
    }
    if (checking) {
      return { status: "checking", label }
    }
    if (checkFailure !== undefined) {
      return { status: "refused", reason: `Pulse could not check the plan: ${checkFailure}` }
    }
    if (problems.length > 0) {
      const count = Labels.plural(problems.length, "problem")
      return {
        status: "refused",
        reason: `Fix ${count} to migrate: ${problems[0]?.message ?? ""}`,
      }
    }
    return this.unmappedOffer() ?? { status: "ready", label }
  }

  private unmappedOffer(): MigrateOffer | undefined {
    const blocked = this.rows.blocked()
    if (blocked.labels.length === 0) {
      return undefined
    }
    const where = blocked.labels.join(", ")
    const has = blocked.labels.length === 1 ? "has" : "have"
    const target = `v${this.state.target?.version ?? ""}`
    if (!blocked.countable) {
      return {
        status: "refused",
        reason: `Instances wait at ${where}, which ${has} no mapping in ${target}. Map them first.`,
      }
    }
    const waits = blocked.count === 1 ? "waits" : "wait"
    const reason = `${blocked.count} of ${this.rows.count} ${waits} at ${where}, which ${has} no mapping in ${target}.`
    const which = blocked.count === 1 ? "one" : String(blocked.count)
    return blocked.count < this.rows.count
      ? { status: "refused", reason, leaveOut: `Leave the ${which} out` }
      : { status: "refused", reason }
  }

  private activeRun(): string | undefined {
    const { run } = this.scene
    if (run?.lingers === true) {
      const failed = Labels.plural(run.progress.failed, "failed item")
      return `The engine keeps the batch of the last run with ${failed}. Remove it first.`
    }
    if (run?.isActive() !== true) {
      return undefined
    }
    const what = Labels.plural(run.progress.total, "instance")
    return `Wait until ${run.plan.action.wording.doing.toLowerCase()} ${what} ends.`
  }

  private notices(): Notice[] {
    const { target, source } = this.state
    const latest = this.state.versions[0]?.definition.version
    if (target === undefined || latest === undefined) {
      return []
    }
    if (target.version < source.version) {
      return [this.info(`v${target.version} is older than v${source.version}.`)]
    }
    return target.version < latest
      ? [this.info(`v${target.version} is not the latest version (v${latest}).`)]
      : []
  }

  private info(title: string): Notice {
    return { tone: "info", title, actions: [] }
  }
}
