/**
 * Names for views that would otherwise show bare ids (U13): metrics carry ids only. Shared by
 * server and widget bundle, so types and pure helpers only.
 */

/**
 * The shape of the kit's `BpmnNames` (`parseBpmnNames`), the one rule camunda7 names the same model
 * by.
 */
export interface ProcessNames {
  /** The process's own name in its model (or its pool's); null when it has none. */
  name: string | null
  /** Element id → name, only for elements that carry a name. */
  elements: Record<string, string>
}

/** A key is absent when its model could not be read: the view then shows the id, never a guess. */
export type NameIndex = Record<string, ProcessNames>

/** `names` is absent where no lookup ran: the view shows ids. */
export type Named<T> = T & { names?: NameIndex }

export function processNameOf(names: NameIndex | undefined, key: string): string | null {
  if (!names || !Object.hasOwn(names, key)) return null
  return names[key].name
}

export function elementNameOf(
  names: NameIndex | undefined,
  key: string,
  id: string,
): string | null {
  if (!names || !Object.hasOwn(names, key)) return null
  const elements = names[key].elements
  return Object.hasOwn(elements, id) ? elements[id] : null
}
