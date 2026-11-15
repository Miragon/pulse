import type { BoardProblem, ChoiceProblemCode, PlainProblemCode } from "./board-problems.js"

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

  add(problem: BoardProblem): void {
    this.found.push(problem.path === "" ? { ...problem, path: "(file)" } : problem)
  }

  plain(path: string, code: PlainProblemCode): void {
    this.add({ path, code })
  }

  choice(path: string, code: ChoiceProblemCode, choices: readonly string[]): void {
    this.add({ path, code, values: { choices } })
  }

  checked<Value>(
    valid: boolean,
    value: Value,
    path: string,
    code: PlainProblemCode,
  ): Value | undefined {
    if (valid) {
      return value
    }
    this.plain(path, code)
    return undefined
  }

  record(value: unknown, path: string): Json | undefined {
    const valid = typeof value === "object" && value !== null && !Array.isArray(value)
    return this.checked(valid, value as Json, path, "notAnObject")
  }

  items(value: unknown, path: string): readonly unknown[] | undefined {
    return this.checked(Array.isArray(value), value as unknown[], path, "notAList")
  }

  onlyKeys(record: Json, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key)) {
        this.choice(ParseProblems.key(path, key), "unknownKey", allowed)
      }
    }
  }

  text(record: Json, key: string, path: string): string | undefined {
    const value = record[key]
    if (value === undefined) {
      return undefined
    }
    const valid = typeof value === "string" && value.trim() !== ""
    return this.checked(valid, value as string, ParseProblems.key(path, key), "blankText")
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
    if (choices.includes(value as Choice)) {
      return value as Choice
    }
    this.choice(ParseProblems.key(path, key), "notOneOf", choices)
    return undefined
  }

  names(
    record: Json,
    key: string,
    path: string,
    code: "engineNames" | "tenantIds" = "engineNames",
  ): readonly string[] | undefined {
    const value = record[key]
    if (value === undefined) {
      return undefined
    }
    const valid =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((name) => typeof name === "string" && name.trim() !== "") &&
      new Set(value).size === value.length
    return this.checked(valid, value as string[], ParseProblems.key(path, key), code)
  }
}
