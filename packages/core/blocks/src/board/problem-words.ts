import type { BoardProblem } from "@miragon/pulse-board"
import { useWords, type Words } from "../messages/translate.js"

/**
 * A problem of a board file in words, the sentence after its JSON path. Its counts read in plain
 * digits, as `BoardProblems.describe` writes them, so the English words equal it.
 */
export function problemText(t: Words, problem: BoardProblem): string {
  switch (problem.code) {
    case "unknownKey":
    case "notOneOf":
    case "variableColumn":
      return t(`problem.${problem.code}`, { choices: problem.values.choices.join(", ") })
    case "unknownVersion":
      return t("problem.unknownVersion", {
        found: problem.values.found,
        reads: String(problem.values.reads),
      })
    case "engineOutsideBoard":
      return t("problem.engineOutsideBoard", {
        engines: problem.values.engines.join(", "),
        count: String(problem.values.engines.length),
      })
    case "tooManyWidgets":
      return t("problem.tooManyWidgets", {
        position: String(problem.values.position),
        max: String(problem.values.max),
      })
    default:
      return t(`problem.${problem.code}`)
  }
}

/** The words of a board file's problems in the language of the nearest `LocaleProvider`. */
export function useProblemWords(): (problem: BoardProblem) => string {
  const t = useWords()
  return (problem) => problemText(t, problem)
}
