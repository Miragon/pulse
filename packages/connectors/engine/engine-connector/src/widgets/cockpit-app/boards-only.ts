import type { CockpitEngineInfo, EngineDialect } from "../../view-models.js"
import type { ListedBoard } from "../../view-models.board.js"

/**
 * An engine as the cockpit lists it: its id and environment, and what the start data of
 * `engine_open_cockpit` or the engine list says of its dialect.
 */
export type CockpitEngine = Pick<
  CockpitEngineInfo,
  "id" | "dialect" | "webAppUrl" | "boards" | "refused"
> & {
  environment?: string
}

/** A dialect the chat's cockpit shows on boards only. */
type BoardsOnlyDialect = Exclude<EngineDialect, "c7">

/** Its product and its web app by their names, the same in every language. */
const DIALECT_NAMES: Readonly<Record<BoardsOnlyDialect, { product: string; webApp: string }>> = {
  c8: { product: "Camunda 8", webApp: "Operate" },
}

/**
 * An engine the cockpit shows on boards only: its dialect, its product, its web app with its
 * address where the profile names one, and the ids of the boards that name it.
 */
export interface BoardsOnlyEngine {
  dialect: BoardsOnlyDialect
  product: string
  webApp: string
  webAppUrl?: string
  boards: readonly string[]
}

/** Null for an engine every route reads: Camunda 7, or a refused profile, whose dialect is unread. */
export function boardsOnlyOf(engine: CockpitEngine | undefined): BoardsOnlyEngine | null {
  if (engine?.dialect === undefined || engine.dialect === "c7") return null
  const { webAppUrl, boards = [] } = engine
  return {
    dialect: engine.dialect,
    ...DIALECT_NAMES[engine.dialect],
    ...(webAppUrl === undefined ? {} : { webAppUrl }),
    boards,
  }
}

/** Every route reads it, so the cross-engine view reads and sums it too. */
export function readsWhole(engine: CockpitEngine): boolean {
  return boardsOnlyOf(engine) === null
}

/** An engine as `engine_list_engines` names it: its dialect, and its web app as written. */
export interface ListedEngineFacts {
  id: string
  dialect?: EngineDialect
  cockpitUrl?: string
}

/**
 * What the engine list says of an engine's dialect, as the start data says it: another dialect's
 * web app (the profile's `cockpitUrl`, which the profile format holds to http(s)) and the ids of
 * the listed boards that name it. Nothing for a refused profile, whose dialect is unread.
 */
export function dialectFactsOf(
  { id, dialect, cockpitUrl }: ListedEngineFacts,
  boards: readonly ListedBoard[],
): Pick<CockpitEngine, "dialect" | "webAppUrl" | "boards"> {
  if (dialect === undefined || dialect === "c7") return dialect === undefined ? {} : { dialect }
  return {
    dialect,
    ...(cockpitUrl === undefined ? {} : { webAppUrl: cockpitUrl }),
    boards: boards.filter(({ engines }) => engines.includes(id)).map((board) => board.id),
  }
}
