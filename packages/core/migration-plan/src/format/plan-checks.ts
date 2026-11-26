import type { MigrationPlanProblem, PlanMapping, PlanSide } from "./plan-definition.js"
import { PlanEcho } from "./plan-echo.js"
import { MigrationPlanRules } from "./plan-rules.js"
import { MigrationPlanVocabulary } from "./plan-vocabulary.js"

type Json = Readonly<Record<string, unknown>>

type PlainCode = Exclude<MigrationPlanProblem, { readonly values: unknown }>["code"]

export class PlanChecks {
  private readonly found: MigrationPlanProblem[] = []
  private readonly sources = new Map<string, number>()

  static isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  static keyPath(path: string, key: string): string {
    const shown = PlanEcho.key(key)
    return path === "" ? shown : `${path}.${shown}`
  }

  get problems(): readonly MigrationPlanProblem[] {
    return this.found
  }

  keys(
    record: Json,
    path: string,
    known: readonly string[],
    onUnknown: (path: string) => void,
  ): void {
    for (const key of Object.keys(record)) {
      const keyPath = PlanChecks.keyPath(path, key)
      if (MigrationPlanVocabulary.FOREIGN_KEYS.includes(key)) {
        this.found.push({ path: keyPath, code: "notInAPlan", values: { key } })
      } else if (!known.includes(key)) {
        onUnknown(keyPath)
      }
    }
  }

  processId(value: unknown): string | undefined {
    return this.checked(value, "bpmnProcessId", "notAProcessId", (id) =>
      MigrationPlanRules.isProcessId(id),
    )
  }

  side(value: unknown, path: "source" | "target"): PlanSide | undefined {
    const record = this.checked(value, path, "notAnObject", (side) => PlanChecks.isRecord(side))
    if (record === undefined) {
      return undefined
    }
    this.closed(record, path, MigrationPlanVocabulary.SIDE_KEYS)
    const version = this.checked(
      record.version,
      PlanChecks.keyPath(path, "version"),
      "notAVersion",
      (number) => MigrationPlanRules.isVersion(number),
    )
    return version === undefined ? undefined : { version }
  }

  distinct(source: PlanSide | undefined, target: PlanSide | undefined): void {
    if (source !== undefined && source.version === target?.version) {
      this.found.push({ path: "target.version", code: "sameVersion" })
    }
  }

  mappings(value: unknown): readonly PlanMapping[] | undefined {
    const list = this.checked(value, "mappings", "notAList", (items) => PlanChecks.isList(items))
    if (list === undefined) {
      return undefined
    }
    const max = MigrationPlanVocabulary.MAX_MAPPINGS
    if (list.length > max) {
      this.found.push({ path: "mappings", code: "tooManyMappings", values: { max } })
      return undefined
    }
    return list.flatMap((item, index) => this.mapping(item, index) ?? [])
  }

  private static isList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value)
  }

  private mapping(value: unknown, index: number): PlanMapping | undefined {
    const path = `mappings[${index}]`
    const record = this.checked(value, path, "notAnObject", (item) => PlanChecks.isRecord(item))
    if (record === undefined) {
      return undefined
    }
    this.closed(record, path, MigrationPlanVocabulary.MAPPING_KEYS)
    const sourcePath = PlanChecks.keyPath(path, "sourceElementId")
    const sourceElementId = this.elementId(record.sourceElementId, sourcePath)
    if (sourceElementId !== undefined) {
      this.once(sourceElementId, index, sourcePath)
    }
    const targetPath = PlanChecks.keyPath(path, "targetElementId")
    const targetElementId = this.elementId(record.targetElementId, targetPath)
    return sourceElementId === undefined || targetElementId === undefined
      ? undefined
      : { sourceElementId, targetElementId }
  }

  private elementId(value: unknown, path: string): string | undefined {
    return this.checked(value, path, "notAnElementId", (id) => MigrationPlanRules.isElementId(id))
  }

  private once(sourceElementId: string, index: number, path: string): void {
    const first = this.sources.get(sourceElementId)
    if (first === undefined) {
      this.sources.set(sourceElementId, index)
    } else {
      this.found.push({ path, code: "sourceTwice", values: { first } })
    }
  }

  private closed(record: Json, path: string, known: readonly string[]): void {
    this.keys(record, path, known, (keyPath) => {
      this.found.push({ path: keyPath, code: "unknownKey", values: { choices: known } })
    })
  }

  private checked<Value>(
    value: unknown,
    path: string,
    code: PlainCode,
    valid: (value: unknown) => value is Value,
  ): Value | undefined {
    if (valid(value)) {
      return value
    }
    this.found.push({ path, code: value === undefined ? "missing" : code })
    return undefined
  }
}
