import type { TargetAuth } from "./engine-target.js"

const KINDS: Readonly<Record<string, TargetAuth>> = {
  none: { kind: "none" },
  basic: { kind: "basic" },
  oauth: { kind: "oauth2" },
}

const SWITCHING_OAUTH_KEYS_OFF = "none"

type WayOut = "authType" | "passthrough" | "authKeys" | "headers" | "oauth"

export class EditorAuth {
  static readonly WAYS_OUT: Readonly<Record<WayOut, string>> = EditorAuth.waysOut()

  static kindOf(type: string): TargetAuth | undefined {
    return KINDS[type]
  }

  static connectsWith(auth: TargetAuth): boolean {
    return auth.kind !== "oauth2"
  }

  private static waysOut(): Readonly<Record<WayOut, string>> {
    const connecting = Object.entries(KINDS)
      .filter(([, auth]) => EditorAuth.connectsWith(auth))
      .map(([type]) => type)
    const takingNoOAuthKeys = connecting.filter((type) => type !== SWITCHING_OAUTH_KEYS_OFF)
    const setType = `Set auth.type to ${EditorAuth.anyOf(connecting)}`
    return {
      authType: `${setType}, ${EditorAuth.keepFor("CLI")}`,
      passthrough: `${setType}, ${EditorAuth.keepFor("MCP server")}`,
      authKeys: `This client connects with auth.type ${EditorAuth.anyOf(connecting)}: use one of them.`,
      headers: "Remove headers from this profile, or use one without them.",
      oauth: `Set auth.type to ${SWITCHING_OAUTH_KEYS_OFF}, or to ${EditorAuth.anyOf(takingNoOAuthKeys)} without the OAuth keys, ${EditorAuth.keepFor("CLI")}`,
    }
  }

  private static anyOf(types: readonly string[]): string {
    return new Intl.ListFormat("en", { type: "disjunction" }).format(types)
  }

  private static keepFor(surface: string): string {
    return `or keep this profile for the ${surface}.`
  }
}
