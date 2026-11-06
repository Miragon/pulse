import { PageCursor } from "../../../contract/index.js"
import type { Window } from "../rest/index.js"

const CURSOR = /^(\d+):(.+)$/

export class PageCursors {
  static windowOf(limit: number, cursor: PageCursor | undefined): Window {
    const after = PageCursors.parts(cursor)?.after
    return after === undefined ? { limit } : { limit, after }
  }

  static seenBefore(cursor: PageCursor | undefined): number {
    return PageCursors.parts(cursor)?.seen ?? 0
  }

  static next(seen: number, endCursor: string): PageCursor {
    return PageCursor(`${String(seen)}:${endCursor}`)
  }

  private static parts(
    cursor: PageCursor | undefined,
  ): { readonly seen: number; readonly after: string } | undefined {
    const match = cursor === undefined ? null : CURSOR.exec(cursor)
    return match === null ? undefined : { seen: Number(match[1]), after: match[2] ?? "" }
  }
}
