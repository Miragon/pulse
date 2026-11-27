/**
 * The version each running instance of an inspected tree runs, from what the inspection's rounds
 * read of the runtime (each instance's definition id and the definitions of the tree), so an
 * instance's detail names the version of a called instance's root incident without the history,
 * which holds no instance at history level NONE and none its cleanup removed. An instance whose
 * definition the runtime does not list with a key and a version has none here. Pure.
 */

import type { DefinitionRef } from "@miragon/pulse-engine-core"
import { num, str } from "../records.js"
import type { InstanceData } from "../types.js"
import { compact } from "../util.js"
import { definitionRefOf } from "./definition-refs.js"

/** The version each instance of the inspected tree runs, by instance id. */
export type DefinitionsByInstance = ReadonlyMap<string, DefinitionRef>

/** Each definition the runtime listed with its key and version, by its id. */
function listedOf(definitions: InstanceData["definitions"]): ReadonlyMap<string, DefinitionRef> {
  return new Map(
    definitions.flatMap((definition) => {
      const id = str(definition, "id")
      const key = str(definition, "key")
      const version = num(definition, "version")
      if (id === undefined || key === undefined || version === undefined) {
        return []
      }
      const name = str(definition, "name")
      return [[id, definitionRefOf({ id, key, version, ...compact({ name }) })] as const]
    }),
  )
}

/** The version each instance of the tree `data` holds runs, where the runtime lists it. */
export function treeVersionsOf(
  data: Pick<InstanceData, "tree" | "definitions">,
): DefinitionsByInstance {
  const listed = listedOf(data.definitions)
  return new Map(
    data.tree.flatMap((node) => {
      const definition = listed.get(node.definitionId)
      return definition === undefined ? [] : [[node.id, definition] as const]
    }),
  )
}
