interface ReviverContext {
  readonly source?: string
}

interface RawJsonSupport {
  rawJSON(text: string): unknown
}

const rawJsonSupport = JSON as unknown as RawJsonSupport

export class LosslessJson {
  static parse(text: string): unknown {
    return JSON.parse(text, (_key: string, value: unknown, context?: ReviverContext) =>
      LosslessJson.keptExact(value, context),
    ) as unknown
  }

  static stringify(value: unknown): string {
    const text = JSON.stringify(value, (_key: string, entry: unknown) =>
      typeof entry === "bigint" ? rawJsonSupport.rawJSON(entry.toString()) : entry,
    ) as string | undefined
    return text ?? "null"
  }

  private static keptExact(value: unknown, context: ReviverContext | undefined): unknown {
    if (LosslessJson.isUnsafeInteger(value) && context?.source !== undefined) {
      return rawJsonSupport.rawJSON(context.source)
    }
    return value
  }

  private static isUnsafeInteger(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)
  }
}
