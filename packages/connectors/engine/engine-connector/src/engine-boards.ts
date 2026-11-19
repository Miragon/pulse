/**
 * The boards of the MCP server: the board files (`*.board.json`) in the directory
 * ENGINE_BOARDS_DIR names, read at configuration like the profiles (a restart reloads them) with
 * the one board format of Pulse for VS Code and Pulse for Orca (@miragon/pulse-board). A board's
 * id is its file name without `.board.json`, by the id rule BOARD_ID; the files are read in the
 * order of their names (a link to a file is read, as a mounted ConfigMap gives them), and a
 * subfolder is not read.
 *
 * A directory or a board file that cannot be read fails the boot, as an unreadable profile file
 * does. A file that gives no board is refused on its own and the other boards show; a file's
 * notes, a refused file, a name the id rule refuses and an entry named like a board file that is
 * no file are boot warnings, a problem in the format's own words (`BoardProblems.describe`, after
 * its JSON path). A board's numbers are read per call by the board feed (`data/board-data.ts`),
 * never here.
 */

import fs from "node:fs"
import path from "node:path"
import { BoardParser } from "@miragon/pulse-board"
import {
  BOARD_FILE_SUFFIX,
  BOARD_ID,
  type BoardFiles,
  boardProblemSentence,
  type EngineBoard,
  type RefusedBoard,
} from "./board-files.js"

/** The variable that names the directory of the board files. */
const BOARDS_DIR_VARIABLE = "ENGINE_BOARDS_DIR"

/** The boards and what the boot tells the operator about them. */
export interface EngineBoards extends BoardFiles {
  readonly warnings: readonly string[]
}

/** What an entry named like a board file gives: a board, a refused file, or why it is not read. */
type FileVerdict =
  | { readonly board: EngineBoard }
  | { readonly refused: RefusedBoard }
  | { readonly skipped: string }

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? "unknown error"
}

/** The names of the directory's board files, sorted; fails the boot when it cannot be read. */
function boardFileNames(dir: string, label: string): string[] {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch (error) {
    const code = errorCode(error)
    const why =
      code === "ENOENT"
        ? "does not exist"
        : code === "ENOTDIR"
          ? "is no directory"
          : `cannot be read (${code})`
    throw new Error(`${label} ${why}: it names the directory of the board files.`, {
      cause: error,
    })
  }
  return names.filter((name) => name.endsWith(BOARD_FILE_SUFFIX)).sort()
}

/**
 * A board file's text, or undefined for an entry that is no file (a folder), a link followed;
 * fails the boot when it cannot be read.
 */
function readBoardFile(file: string, name: string, label: string): string | undefined {
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8") : undefined
  } catch (error) {
    throw new Error(`${label}: the board file ${name} cannot be read (${errorCode(error)}).`, {
      cause: error,
    })
  }
}

/** A file whose name the id rule refuses: it is not read. */
function skippedWarning(name: string): string {
  return `The board file ${name} (${BOARDS_DIR_VARIABLE}) is not read: a board's id is its file name without ${BOARD_FILE_SUFFIX}, a letter or digit first, then letters, digits, ".", "_" and "-", 64 at most. Rename the file to show its board.`
}

/** An entry named like a board file that is no file: a subfolder is not read. */
function noFileWarning(name: string): string {
  return `The entry ${name} (${BOARDS_DIR_VARIABLE}) is not read: it is no file, and a subfolder is not read. Put each board file in the directory itself.`
}

function verdictOf(dir: string, name: string, label: string): FileVerdict {
  const id = name.slice(0, -BOARD_FILE_SUFFIX.length)
  if (!BOARD_ID.test(id)) return { skipped: skippedWarning(name) }
  const text = readBoardFile(path.join(dir, name), name, label)
  if (text === undefined) return { skipped: noFileWarning(name) }
  const parsed = BoardParser.parse(text)
  if ("problems" in parsed) return { refused: { id, file: name, problems: parsed.problems } }
  return { board: { id, file: name, board: parsed.board, notes: parsed.notes } }
}

/** A refused file's warning; that the other boards show only when another file gave one. */
function refusedWarning({ file, problems }: RefusedBoard, others: boolean): string {
  const reasons = problems.map(boardProblemSentence).join("; ")
  const rest = others ? " The other boards show." : ""
  return `The board file ${file} (${BOARDS_DIR_VARIABLE}) gives no board: ${reasons}.${rest}`
}

/** The engines a board names that no profile of this server names: it shows them unconfigured. */
function foreignEngines(board: EngineBoard, engineIds: readonly string[]): string[] {
  const foreign = board.board.engines.filter((name) => !engineIds.includes(name))
  if (foreign.length === 0) return []
  const verb = foreign.length === 1 ? "names an engine" : "names engines"
  return [
    `The board file ${board.file} (${BOARDS_DIR_VARIABLE}) ${verb} no profile of this server names: ${foreign.join(", ")}. The board shows ${foreign.length === 1 ? "it" : "them"} as not configured.`,
  ]
}

/** What the boot says about one entry: why it is not read, its refusal, or its notes and engines. */
function warningsOf(verdict: FileVerdict, engineIds: readonly string[], others: boolean): string[] {
  if ("skipped" in verdict) return [verdict.skipped]
  if ("refused" in verdict) return [refusedWarning(verdict.refused, others)]
  const { board } = verdict
  return [
    ...board.notes.map(
      (note) =>
        `The board file ${board.file} (${BOARDS_DIR_VARIABLE}): ${boardProblemSentence(note)}.`,
    ),
    ...foreignEngines(board, engineIds),
  ]
}

/**
 * The boards of the directory ENGINE_BOARDS_DIR names, or none when it is unset or blank.
 * `engineIds` are the names of the server's profiles, refused ones included: a board engine
 * outside them is a warning. Throws a one-line error naming the variable when the directory or
 * one of its board files cannot be read.
 */
export function loadEngineBoards(
  env: NodeJS.ProcessEnv,
  engineIds: readonly string[],
): EngineBoards | undefined {
  const dir = env[BOARDS_DIR_VARIABLE]?.trim()
  if (!dir) return undefined
  const resolved = path.resolve(dir)
  const label =
    resolved === dir
      ? `${BOARDS_DIR_VARIABLE}=${dir}`
      : `${BOARDS_DIR_VARIABLE}=${dir} (resolved ${resolved})`
  const verdicts = boardFileNames(resolved, label).map((name) => verdictOf(resolved, name, label))
  const boards = verdicts.flatMap((verdict) => ("board" in verdict ? [verdict.board] : []))
  const refused = verdicts.flatMap((verdict) => ("refused" in verdict ? [verdict.refused] : []))
  const warnings = verdicts.flatMap((verdict) => warningsOf(verdict, engineIds, boards.length > 0))
  if (boards.length === 0 && refused.length === 0) {
    warnings.push(
      `${label} holds no board file (*${BOARD_FILE_SUFFIX}): the server shows no board.`,
    )
  }
  return { boards, refused, warnings }
}
