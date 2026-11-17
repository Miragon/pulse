export type PresentFields<Entries> = { [Key in keyof Entries]?: Exclude<Entries[Key], undefined> }

export class Present {
  static fields<Entries extends object>(entries: Entries): PresentFields<Entries> {
    return Object.fromEntries(
      Object.entries(entries).filter(([, value]) => value !== undefined),
    ) as PresentFields<Entries>
  }
}
