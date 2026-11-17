import type { CockpitEngineInfo, EngineDialect } from "../../view-models.js"

/**
 * An engine as the cockpit lists it: its id and environment, and what the start data of
 * `engine_open_cockpit` says of its dialect, which the engine list does not.
 */
export type CockpitEngine = Pick<CockpitEngineInfo, "id" | "dialect" | "webAppUrl" | "boards"> & {
  environment?: string
}

/** A dialect the server reads on boards only. */
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

/** The dialect facts of the start data, by id: the engine list names an engine without them. */
export function dialectFactsOf(
  engine: CockpitEngine | undefined,
): Pick<CockpitEngine, "dialect" | "webAppUrl" | "boards"> {
  if (engine?.dialect === undefined) return {}
  const { dialect, webAppUrl, boards } = engine
  return {
    dialect,
    ...(webAppUrl === undefined ? {} : { webAppUrl }),
    ...(boards === undefined ? {} : { boards }),
  }
}
