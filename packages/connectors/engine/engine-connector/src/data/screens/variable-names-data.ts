/**
 * The variable names a process screen's condition dialog offers, over the engine a call resolved,
 * in any dialect: the engine contract's `listVariableNames` of one version (on Camunda 7 the names
 * the history keeps for its newest instances) and the kinds of condition the engine refuses
 * (`refusedVariableConditions`, Camunda 8: an ordering and a date), which the dialog offers
 * disabled with their reason. The names load the engine's history, so they stand on the floor of
 * 30 s per caller and version (`screen-floor.ts`).
 */

import { DefinitionId } from "@miragon/pulse-engine-core"
import type { VariableConditionKindCode } from "@miragon/pulse-screens"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"
import { screenFloor } from "./screen-floor.js"

/** The feed's answer: the version, the names its instances' variables go by and the refused kinds. */
export interface VariableNamesFeedData {
  readonly definitionId: string
  readonly names: readonly string[]
  readonly refused: readonly VariableConditionKindCode[]
}

/** The variable names of `definitionId` on `engine`. */
async function readVariableNames(
  engine: RuntimeEngine,
  definitionId: string,
): Promise<VariableNamesFeedData> {
  const runtime = runtimeOf(engine)
  const names = await runtime.listVariableNames(DefinitionId(definitionId))
  return {
    definitionId,
    names: [...names],
    refused: [...(runtime.refusedVariableConditions?.() ?? [])],
  }
}

const namesFloor = screenFloor<VariableNamesFeedData>()

/** The variable names of `definitionId` on `engine`: one read in the floor's 30 s. */
export function buildVariableNamesData(
  engine: RuntimeEngine,
  definitionId: string,
): Promise<VariableNamesFeedData> {
  return namesFloor(engine, { definitionId }, () => readVariableNames(engine, definitionId))
}
