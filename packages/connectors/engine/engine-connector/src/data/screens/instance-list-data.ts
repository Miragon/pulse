/**
 * The web app's instance list of a process screen over the engine a call resolved, in any dialect:
 * a page of 50 instances of one version by its filter (a scope, an element, the exact business key,
 * variable conditions) and its cursor, and on the first page the counts of the scopes, by the
 * screens' builder (`InstanceList` of @miragon/pulse-screens/builder) over the engine contract's
 * runtime of the engine (`runtimeOf`), serialized by `ScreenJson`: the same JSON the editors'
 * adapters build from the same answers (D2). The rows and the counts are the list, so a failure of
 * either is the read's. A condition of a kind the engine refuses (Camunda 8: an ordering or a
 * date) is a refusal no retry changes (`REFUSED_CONDITION`), before anything is read. The search
 * and the history counts load the engine's database, so the first page stands on the floor of 30 s
 * per caller and arguments (`screen-floor.ts`), which a Refresh repeats; a later page is read each
 * time, since its cursor belongs to the first page read before it (on Camunda 7 an offset every
 * first page names alike), and a later page kept from an older read would leave a gap after a newer
 * first page.
 */

import { DefinitionId, PageCursor } from "@miragon/pulse-engine-core"
import {
  VariableConditionTypes,
  type InstanceListData,
  type InstanceListFilterData,
  type InstanceScopeCode,
  type VariableConditionData,
  type VariableConditionKindCode,
} from "@miragon/pulse-screens"
import { InstanceList, ScreenJson } from "@miragon/pulse-screens/builder"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"
import { screenFloor } from "./screen-floor.js"

/** What the feed takes: the version, the list's filter and the cursor of a later page. */
export interface InstanceListRequestData {
  readonly definitionId: string
  readonly scope: InstanceScopeCode
  readonly element?: string | undefined
  readonly businessKey?: string | undefined
  readonly variables?: readonly VariableConditionData[] | undefined
  readonly after?: string | undefined
}

/** The refusal of a condition of a kind the engine refuses: no retry changes it. */
class RefusedConditionError extends Error {
  readonly code = "REFUSED_CONDITION" as const

  constructor(condition: VariableConditionData, kind: VariableConditionKindCode, engineId: string) {
    const what = kind === "date" ? "a date" : "greater or less than"
    super(
      `Engine "${engineId}" can't compare a variable by ${what}, so the condition on "${condition.name}" finds nothing it can read.`,
    )
    this.name = "RefusedConditionError"
  }
}

/** The kind of `condition` an engine may refuse: an ordering, a date; none for the rest. */
function kindOf(condition: VariableConditionData): VariableConditionKindCode | undefined {
  if (condition.operator === "like") return undefined
  if (VariableConditionTypes.of(condition) === "date") return "date"
  return condition.operator === "greaterThan" || condition.operator === "lessThan"
    ? "ordering"
    : undefined
}

/** The list's filter as the builder takes it, without the parts the request leaves out. */
function filterOf({
  scope,
  element,
  businessKey,
  variables,
}: InstanceListRequestData): InstanceListFilterData {
  return {
    scope,
    ...(element === undefined ? {} : { elementId: element }),
    ...(businessKey === undefined ? {} : { businessKey }),
    ...(variables === undefined || variables.length === 0 ? {} : { variables }),
  }
}

/** The instance list of `request` on `engine`, read at `now`. */
async function readInstanceList(
  engine: RuntimeEngine,
  request: InstanceListRequestData,
  now: () => Date,
): Promise<InstanceListData> {
  const runtime = runtimeOf(engine)
  const refused = new Set(runtime.refusedVariableConditions?.() ?? [])
  for (const condition of request.variables ?? []) {
    const kind = kindOf(condition)
    if (kind !== undefined && refused.has(kind)) {
      throw new RefusedConditionError(condition, kind, engine.engineId)
    }
  }
  const model = await InstanceList.read(
    engine.engineId,
    {
      definitionId: DefinitionId(request.definitionId),
      filter: filterOf(request),
      ...(request.after === undefined ? {} : { after: PageCursor(request.after) }),
    },
    runtime,
    now,
  )
  return ScreenJson.instanceList(model)
}

const listFloor = screenFloor<InstanceListData>()

/**
 * The instance list of `request` on `engine`, read at `now`: its first page one read in the floor's
 * 30 s, a later page read each time.
 */
export function buildInstanceListData(
  engine: RuntimeEngine,
  request: InstanceListRequestData,
  now: () => Date = () => new Date(),
): Promise<InstanceListData> {
  const read = () => readInstanceList(engine, request, now)
  return request.after === undefined ? listFloor(engine, request, read) : read()
}
