export type PlainProblemCode =
  | "notJson"
  | "notAnObject"
  | "notAList"
  | "missing"
  | "ignoredKey"
  | "schemaNotText"
  | "blankText"
  | "engineNames"
  | "tenantIds"
  | "diagramOnOneEngine"
  | "notWholeNumber"
  | "noColumns"
  | "notBoolean"
  | "elementWithoutProcess"
  | "elementOnEnded"
  | "endedWithIncident"
  | "tenantsNotRead"

export type ChoiceProblemCode = "unknownKey" | "notOneOf" | "variableColumn"

interface PlainProblem {
  readonly path: string
  readonly code: PlainProblemCode
}

interface ChoiceProblem {
  readonly path: string
  readonly code: ChoiceProblemCode
  readonly values: { readonly choices: readonly string[] }
}

interface VersionProblem {
  readonly path: string
  readonly code: "unknownVersion"
  readonly values: { readonly found: string; readonly reads: number }
}

interface OutsideProblem {
  readonly path: string
  readonly code: "engineOutsideBoard"
  readonly values: { readonly engines: readonly string[] }
}

interface LimitProblem {
  readonly path: string
  readonly code: "tooManyWidgets"
  readonly values: { readonly position: number; readonly max: number }
}

export type BoardProblem =
  PlainProblem | ChoiceProblem | VersionProblem | OutsideProblem | LimitProblem

export type BoardProblemCode = BoardProblem["code"]

export class BoardProblems {
  private static readonly PLAIN: Readonly<Record<PlainProblemCode, string>> = {
    notJson: "is not valid JSON",
    notAnObject: "must be an object",
    notAList: "must be a list",
    missing: "is missing",
    ignoredKey: "is not a key this version of Pulse knows; Pulse shows the board without it",
    schemaNotText:
      "must be a text, the path or URL of the board schema; Pulse shows the board without it",
    blankText: "must be a text that is not empty",
    engineNames: "must be a list of different engine names that is not empty",
    tenantIds: "must be a list of different tenant ids that is not empty",
    diagramOnOneEngine:
      "must name one engine, because a diagram shows the deployment of one engine",
    notWholeNumber: "must be a whole number of 0 or more",
    noColumns: "must name at least one column",
    notBoolean: "must be true or false",
    elementWithoutProcess: "needs a process: element ids are only unique within one process",
    elementOnEnded: 'only matches running instances; remove it or use state "running"',
    endedWithIncident:
      'only matches running instances, since an ended instance has no open incident; remove it or use state "running"',
    tenantsNotRead:
      "is set, but Pulse has no tenant filter and would read every tenant here; remove tenants to show this widget",
  }

  static describe(problem: BoardProblem): string {
    switch (problem.code) {
      case "unknownKey":
        return `is not a known key; use ${problem.values.choices.join(", ")}`
      case "notOneOf":
        return `must be one of ${problem.values.choices.join(", ")}`
      case "variableColumn":
        return `cannot show a variable; must be one of ${problem.values.choices.join(", ")}`
      case "unknownVersion":
        return `is ${problem.values.found}; this version of Pulse reads version ${String(problem.values.reads)}`
      case "engineOutsideBoard":
        return BoardProblems.outside(problem.values.engines)
      case "tooManyWidgets":
        return `is widget ${String(problem.values.position)}; a board shows at most ${String(problem.values.max)}, so it stays cheap for the engines`
      default:
        return BoardProblems.PLAIN[problem.code]
    }
  }

  private static outside(engines: readonly string[]): string {
    const verb = engines.length === 1 ? "is" : "are"
    return `may only name engines of the board; ${engines.join(", ")} ${verb} not in its engines`
  }
}
