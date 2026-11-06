const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/

export class ProfileRules {
  static isScopeList(value: unknown): value is readonly string[] {
    return (
      Array.isArray(value) &&
      value.every((scope) => typeof scope === "string" && SCOPE_TOKEN.test(scope)) &&
      new Set(value).size === value.length
    )
  }
}
