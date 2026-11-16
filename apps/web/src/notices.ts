/**
 * What the page's frame tells about the session while a view shows: that it ended (a call found
 * it gone) or that a sign-out did not go through. One notice at a time, the latest; the frame
 * reads it with `useSyncExternalStore`.
 */
export type PageNotice = "ended" | "sign-out-failed"

export class PageNotices {
  private notice: PageNotice | undefined = undefined
  private readonly listeners = new Set<() => void>()

  readonly current = (): PageNotice | undefined => this.notice

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  show(notice: PageNotice): void {
    if (this.notice === notice) return
    this.notice = notice
    for (const listener of this.listeners) listener()
  }
}
