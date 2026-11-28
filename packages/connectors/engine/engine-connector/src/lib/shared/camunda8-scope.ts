import { ENGINE_GET_BOARD, ENGINE_GET_SCREEN, ENGINE_OPEN_COCKPIT } from "../../tool-names.js"
import type { CockpitSection } from "../../view-models.js"
import { ROUTE_DIALECTS, routeServes } from "../../view-models.dialects.js"

/**
 * What the server reads a Camunda 8 engine with, as the generated texts name it: the module
 * instructions, the refusal ENGINE_DIALECT_NOT_SERVED and the boot's warning about a default; the
 * cockpit's model context of such an engine sends its views. Browser code, so a widget imports it
 * too. The model's tools besides engine_list_engines (which lists the engines and reads none),
 * held to what a server of Camunda 8 engines alone lists by `camunda8-scope.test.ts`, so a tool
 * that comes to serve the dialect fails there until the texts name it; the cockpit's views come
 * from their marks (`ROUTE_DIALECTS`) as they are.
 */
export const CAMUNDA_8_TOOLS: readonly string[] = [ENGINE_GET_SCREEN, ENGINE_GET_BOARD]

/** The cockpit's views whose mark serves a Camunda 8 engine, in the order of `ROUTE_DIALECTS`. */
export function camunda8Views(): readonly CockpitSection[] {
  return (Object.keys(ROUTE_DIALECTS) as CockpitSection[]).filter((section) =>
    routeServes(section, "c8"),
  )
}

/** "a and b", "a, b and c". */
function listed(words: readonly string[]): string {
  return words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`
}

/**
 * The tools that read `engine` and the tool that shows it: "engine_get_screen and engine_get_board
 * read them, engine_open_cockpit shows them (view board or landing)".
 */
export function camunda8Reads(engine: string, pronoun: string): string {
  return (
    `${listed(CAMUNDA_8_TOOLS)} read ${engine}, ${ENGINE_OPEN_COCKPIT} shows ${pronoun} ` +
    `(view ${camunda8Views().join(" or ")})`
  )
}
