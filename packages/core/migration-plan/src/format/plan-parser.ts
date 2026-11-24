import type {
  MigrationPlanNote,
  MigrationPlanParse,
  MigrationPlanProblem,
} from "./plan-definition.js"
import { PlanChecks } from "./plan-checks.js"
import { MigrationPlanVocabulary } from "./plan-vocabulary.js"

type Json = Readonly<Record<string, unknown>>

export class MigrationPlanParser {
  private static readonly FILE = "(file)"
  private readonly checks = new PlanChecks()
  private readonly notes: MigrationPlanNote[] = []

  static parse(text: string): MigrationPlanParse {
    const max = MigrationPlanVocabulary.MAX_PLAN_CHARACTERS
    if (text.length > max) {
      return { problems: [{ path: MigrationPlanParser.FILE, code: "tooLarge", values: { max } }] }
    }
    let document: unknown
    try {
      document = JSON.parse(text)
    } catch {
      return { problems: [{ path: MigrationPlanParser.FILE, code: "notJson" }] }
    }
    return new MigrationPlanParser().planOf(document)
  }

  private static refusalOf(record: Json): MigrationPlanProblem | undefined {
    const enginePlanKey = Object.keys(record).find((key) =>
      MigrationPlanVocabulary.ENGINE_PLAN_KEYS.includes(key),
    )
    if (enginePlanKey !== undefined) {
      return { path: enginePlanKey, code: "enginePlan" }
    }
    const version = record.schemaVersion
    const reads = MigrationPlanVocabulary.SCHEMA_VERSION
    return version === undefined || version === reads
      ? undefined
      : {
          path: "schemaVersion",
          code: "unknownVersion",
          values: { found: JSON.stringify(version), reads },
        }
  }

  private planOf(document: unknown): MigrationPlanParse {
    if (!PlanChecks.isRecord(document)) {
      return { problems: [{ path: MigrationPlanParser.FILE, code: "notAnObject" }] }
    }
    const refusal = MigrationPlanParser.refusalOf(document)
    if (refusal !== undefined) {
      return { problems: [refusal] }
    }
    this.noteRootKeys(document)
    const bpmnProcessId = this.checks.processId(document.bpmnProcessId)
    const source = this.checks.side(document.source, "source")
    const target = this.checks.side(document.target, "target")
    this.checks.distinct(source, target)
    const mappings = this.checks.mappings(document.mappings)
    const problems = this.checks.problems
    if (
      bpmnProcessId === undefined ||
      source === undefined ||
      target === undefined ||
      mappings === undefined ||
      problems.length > 0
    ) {
      return { problems }
    }
    return { plan: { bpmnProcessId, source, target, mappings }, notes: this.notes }
  }

  private noteRootKeys(record: Json): void {
    this.checks.keys(record, "", MigrationPlanVocabulary.ROOT_KEYS, (path) => {
      this.notes.push({ path, code: "ignoredKey" })
    })
    if (record.$schema !== undefined && typeof record.$schema !== "string") {
      this.notes.push({ path: "$schema", code: "schemaNotText" })
    }
  }
}
