import type { BoardFilter } from "./board-definition.js"
import { BoardVocabulary } from "./board-vocabulary.js"
import { ParseProblems } from "./parse-problems.js"

const RUNNING_FILTER: BoardFilter = { state: "running" }

export class FilterParser {
  constructor(private readonly problems: ParseProblems) {}

  parse(value: unknown, path: string): BoardFilter | undefined {
    if (value === undefined) {
      return RUNNING_FILTER
    }
    const record = this.problems.record(value, path)
    if (record === undefined) {
      return undefined
    }
    const before = this.problems.list.length
    this.problems.onlyKeys(record, BoardVocabulary.FILTER_KEYS, path)
    const process = this.problems.text(record, "process", path)
    const activeElement = this.problems.text(record, "activeElement", path)
    const businessKey = this.problems.text(record, "businessKey", path)
    const state = this.problems.oneOf(record, "state", BoardVocabulary.STATES, path) ?? "running"
    const withIncident = this.flag(record.withIncident, ParseProblems.key(path, "withIncident"))
    if (activeElement !== undefined) {
      this.checkElement(process, state, ParseProblems.key(path, "activeElement"))
    }
    if (this.problems.list.length > before) {
      return undefined
    }
    return {
      state,
      ...(process === undefined ? {} : { process }),
      ...(activeElement === undefined ? {} : { activeElement }),
      ...(businessKey === undefined ? {} : { businessKey }),
      ...(withIncident === undefined ? {} : { withIncident }),
    }
  }

  private flag(value: unknown, path: string): boolean | undefined {
    const valid = value === undefined || typeof value === "boolean"
    return this.problems.checked(valid, value as boolean | undefined, path, "must be true or false")
  }

  private checkElement(process: string | undefined, state: string, path: string): void {
    if (process === undefined) {
      this.problems.add(path, "needs a process: element ids are only unique within one process")
    }
    if (state === "ended") {
      this.problems.add(path, 'only matches running instances; remove it or use state "running"')
    }
  }
}
