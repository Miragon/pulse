/** How a problem names the key it is about. */

import { isKeyLike } from "./syntax.js"
import type { Problem, ProblemCode } from "./types.js"

/**
 * A problem about `key` of the object at `parent` (`auth`, `headers`; undefined for a profile
 * or the root): it names `parent.key`, or no key at all when `key` does not look like one, since
 * that may be a credential typed in the wrong place.
 */
export function keyed(code: ProblemCode, parent: string | undefined, key: string): Problem {
  if (!isKeyLike(key)) return { code }
  return { code, key: parent === undefined ? key : `${parent}.${key}` }
}
