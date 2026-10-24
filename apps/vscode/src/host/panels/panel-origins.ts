export class PanelOrigins {
  private readonly origins = new Map<string, string>()

  constructor(private readonly isOpen: (key: string) => boolean) {}

  remember(key: string, origin: string | undefined): void {
    if (origin === undefined || this.of(key) !== undefined || this.leadsTo(origin, key)) {
      return
    }
    this.origins.set(key, origin)
  }

  of(key: string): string | undefined {
    const origin = this.origins.get(key)
    return origin !== undefined && this.isOpen(origin) ? origin : undefined
  }

  forget(key: string): void {
    this.origins.delete(key)
  }

  private leadsTo(from: string, key: string): boolean {
    const seen = new Set<string>()
    for (let at: string | undefined = from; at !== undefined; at = this.of(at)) {
      if (at === key || seen.has(at)) {
        return true
      }
      seen.add(at)
    }
    return false
  }
}
