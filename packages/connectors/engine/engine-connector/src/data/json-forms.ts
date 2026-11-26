/**
 * The JSON forms the model's screen and board tools hand on (`tools/screens.ts`, owner decision
 * 2026-11-24, #666): a web app screen's form (`@miragon/pulse-screens`) or a built board's
 * (`@miragon/pulse-board`), with the form's version, which a page checks before it renders the
 * form with @miragon/pulse-blocks. No builder of their own: each is read by the builder its feed
 * calls (`screens/*-screen-data.ts`, `board-data.ts`), the engine and process screens and a board
 * on that feed's floor of 30 s per caller and arguments, so a page and the web app asking alike
 * cost the engine one read; an instance's screen has no floor, as its feed has none, and is read
 * anew on every call. What only the web app reads beside a form (its link into the engine's web
 * app, a card's cause in the cockpit) stays out, so `data` is the form and nothing else.
 */

import { type BoardData, BoardVocabulary } from "@miragon/pulse-board"
import {
  type EngineScreenData,
  type InstanceScreenData,
  type ProcessScreenData,
  ScreenFormat,
} from "@miragon/pulse-screens"
import type { BoardFiles } from "../board-files.js"
import type { RuntimeEngine } from "../lib/engine/resolve-engine.js"
import { type BoardEngineResolver, boardOf, cachedBoardData } from "./board-data.js"
import { buildEngineScreenData } from "./screens/engine-screen-data.js"
import { buildInstanceScreenData } from "./screens/instance-screen-data.js"
import { buildProcessScreenData } from "./screens/process-screen-data.js"

/** A screen's JSON form as the tool returns it: which screen, the form's version, the form. */
export type ScreenFormData =
  | { readonly screen: "engine"; readonly formatVersion: number; readonly data: EngineScreenData }
  | { readonly screen: "process"; readonly formatVersion: number; readonly data: ProcessScreenData }
  | {
      readonly screen: "instance"
      readonly formatVersion: number
      readonly data: InstanceScreenData
    }

/** A built board as the tool returns it: its id, the form's version, when it was read, the form. */
export interface BoardFormData {
  readonly board: string
  readonly formatVersion: number
  readonly asOf: string
  readonly data: BoardData
}

/** The screen a call asks for, with the ids it reads by. */
export type ScreenFormTarget =
  | { readonly screen: "engine" }
  | { readonly screen: "process"; readonly process: string; readonly version?: number | undefined }
  | { readonly screen: "instance"; readonly instanceId: string }

/** A feed's payload without what only the web app reads beside the form: the form alone. */
function formOf<T extends object, K extends keyof T>(payload: T, extras: readonly K[]): Omit<T, K> {
  const kept = Object.entries(payload).filter(
    ([key]) => !(extras as readonly PropertyKey[]).includes(key),
  )
  return Object.fromEntries(kept) as Omit<T, K>
}

/** The JSON form of `target` on `engine`, read as its feed reads it, without the feed's extras. */
export async function readScreenForm(
  engine: RuntimeEngine,
  target: ScreenFormTarget,
): Promise<ScreenFormData> {
  const formatVersion = ScreenFormat.JSON_VERSION
  switch (target.screen) {
    case "engine": {
      const data = formOf(await buildEngineScreenData(engine), ["webApp"])
      return { screen: "engine", formatVersion, data }
    }
    case "process": {
      const { process, version } = target
      const data = formOf(await buildProcessScreenData(engine, { process, version }), ["webApp"])
      return { screen: "process", formatVersion, data }
    }
    case "instance": {
      const screen = await buildInstanceScreenData(engine, target.instanceId)
      return { screen: "instance", formatVersion, data: formOf(screen, ["webApp", "causes"]) }
    }
  }
}

/**
 * The board `board` names among `files`, read as the board feed reads it (its engines resolved by
 * name under the call, the build kept 30 s per caller), its read time beside its form.
 */
export async function readBoardForm(
  files: BoardFiles | undefined,
  board: string,
  resolve: BoardEngineResolver,
): Promise<BoardFormData> {
  const { asOf, ...data } = await cachedBoardData(boardOf(files, board), resolve)
  return { board, formatVersion: BoardVocabulary.JSON_VERSION, asOf, data }
}
