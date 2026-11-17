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

/**
 * A note of a board in one line: a note of the file after its JSON path, which its author edits;
 * the builder's note on a diagram after the tile's title and engine, which whoever reads the board
 * sees on it.
 */
function noteLine(t: Words, note: BoardProblem): string {
  const subject =
    note.code === "diagramTooLong"
      ? t("note.tile", { title: note.values.title, engine: note.values.engine })
      : note.path
  return `${subject} ${problemText(t, note)}`
}

/** The words of a board file's problems in the language of the nearest `LocaleProvider`. */
export function useProblemWords(): (problem: BoardProblem) => string {
  const t = useWords()
  return (problem) => problemText(t, problem)
}

/** A board's notes, each in one line, in the language of the nearest `LocaleProvider`. */
export function useNoteLines(): (note: BoardProblem) => string {
  const t = useWords()
  return (note) => noteLine(t, note)
}
