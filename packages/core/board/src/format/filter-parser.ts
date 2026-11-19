import type { BoardFilter } from "./board-definition.js"
import { BoardVocabulary } from "./board-vocabulary.js"
import { ParseProblems, type Json } from "./parse-problems.js"

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
    const filter = this.read(record, path)
    this.check(filter, path)
    return this.problems.list.length > before ? undefined : filter
  }

  private read(record: Json, path: string): BoardFilter {
    this.problems.onlyKeys(record, BoardVocabulary.FILTER_KEYS, path)
    const process = this.problems.text(record, "process", path)
    const activeElement = this.problems.text(record, "activeElement", path)
    const businessKey = this.problems.text(record, "businessKey", path)
    const state = this.problems.oneOf(record, "state", BoardVocabulary.STATES, path) ?? "running"
    const withIncident = this.flag(record.withIncident, ParseProblems.key(path, "withIncident"))
    return {
      state,
      ...(process === undefined ? {} : { process }),
      ...(activeElement === undefined ? {} : { activeElement }),
      ...(businessKey === undefined ? {} : { businessKey }),
      ...(withIncident === undefined ? {} : { withIncident }),
    }
  }

  private check(filter: BoardFilter, path: string): void {
    if (filter.activeElement !== undefined) {
      this.checkElement(filter.process, filter.state, ParseProblems.key(path, "activeElement"))
    }
    if (filter.withIncident === true && filter.state === "ended") {
      this.problems.plain(ParseProblems.key(path, "withIncident"), "endedWithIncident")
    }
  }

  private flag(value: unknown, path: string): boolean | undefined {
    const valid = value === undefined || typeof value === "boolean"
    return this.problems.checked(valid, value as boolean | undefined, path, "notBoolean")
  }

  private checkElement(process: string | undefined, state: string, path: string): void {
    if (process === undefined) {
      this.problems.plain(path, "elementWithoutProcess")
    }
    if (state === "ended") {
      this.problems.plain(path, "elementOnEnded")
    }
  }
}
