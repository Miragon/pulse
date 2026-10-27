import type { BoardProblem } from "../protocol/index.js"

export type Json = Readonly<Record<string, unknown>>

export class ParseProblems {
  private readonly found: BoardProblem[] = []

  static key(path: string, key: string): string {
    return path === "" ? key : `${path}.${key}`
  }

  static index(path: string, index: number): string {
    return `${path}[${index}]`
  }

  get list(): readonly BoardProblem[] {
    return this.found
  }

  add(path: string, reason: string): void {
    this.found.push({ path: path === "" ? "(file)" : path, reason })
  }

  checked<Value>(valid: boolean, value: Value, path: string, reason: string): Value | undefined {
    if (valid) {
      return value
    }
    this.add(path, reason)
    return undefined
  }

  record(value: unknown, path: string): Json | undefined {
    const valid = typeof value === "object" && value !== null && !Array.isArray(value)
    return this.checked(valid, value as Json, path, "must be an object")
  }

  items(value: unknown, path: string): readonly unknown[] | undefined {
    return this.checked(Array.isArray(value), value as unknown[], path, "must be a list")
  }

  onlyKeys(record: Json, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key)) {
        this.add(ParseProblems.key(path, key), `is not a known key; use ${allowed.join(", ")}`)
      }
    }
  }

  text(record: Json, key: string, path: string): string | undefined {
    const value = record[key]
    if (value === undefined) {
      return undefined
    }
    const valid = typeof value === "string" && value.trim() !== ""
    return this.checked(
      valid,
      value as string,
      ParseProblems.key(path, key),
      "must be a text that is not empty",
    )
  }

  oneOf<Choice extends string>(
    record: Json,
    key: string,
    choices: readonly Choice[],
    path: string,
  ): Choice | undefined {
    const value = record[key]
    if (value === undefined) {
      return undefined
    }
    return this.checked(
      choices.includes(value as Choice),
      value as Choice,
      ParseProblems.key(path, key),
      `must be one of ${choices.join(", ")}`,
    )
  }

  names(record: Json, key: string, path: string): readonly string[] | undefined {
    const value = record[key]
    if (value === undefined) {
      return undefined
    }
    const valid =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((name) => typeof name === "string" && name.trim() !== "") &&
      new Set(value).size === value.length
    return this.checked(
      valid,
      value as string[],
      ParseProblems.key(path, key),
      "must be a list of different engine names that is not empty",
    )
  }
}
