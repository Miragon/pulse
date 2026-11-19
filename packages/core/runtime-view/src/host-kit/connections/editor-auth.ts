import {
  type AuthType,
  authTypeOf,
  DEFAULT_FLAVOR,
  type Dialect,
  DIALECT_AUTH_TYPES,
  describeProblem,
  dialectOf,
  FLAVORS,
  flavorsOf,
  type Profile,
  type ProfileAuth,
} from "@miragon/pulse-profile"
import type { TargetAuth } from "./engine-target.js"
import type { ProfileSource } from "./profile-source.js"
import { TokenEndpoint } from "./token-endpoint.js"

export interface LoginFields {
  readonly identity?: string
  readonly secret: string
}

export interface Refused {
  readonly refused: string
}

const KINDS: Readonly<Partial<Record<AuthType, TargetAuth>>> = {
  none: { kind: "none" },
  basic: { kind: "basic" },
  oauth: { kind: "oauth2" },
}

const CONNECTING: readonly AuthType[] = ["none", "basic", "clientCredentials"]
const SIGNING_IN: readonly AuthType[] = ["basic", "clientCredentials"]
const TAKING_OAUTH_KEYS: ReadonlySet<AuthType> = new Set(["oauth", "clientCredentials"])
const SWITCHING_OAUTH_KEYS_OFF = "none"
const CLI_DIALECT: Dialect = FLAVORS[DEFAULT_FLAVOR]
const BASIC_LOGIN: LoginFields = { identity: "Username", secret: "Password" }
const CLIENT_LOGIN: LoginFields = { identity: "Client ID", secret: "Client secret" }
const SECRET_ONLY: LoginFields = { secret: "Client secret" }

export class EditorAuth {
  static readonly DIALECTS: readonly Dialect[] = [...new Set(Object.values(FLAVORS))]

  static readonly AUTH_TYPES: readonly AuthType[] = ["none", "basic", "oauth", "clientCredentials"]

  static of(profile: Profile): TargetAuth | Refused {
    const type = authTypeOf(profile)
    if (type === "clientCredentials") {
      return EditorAuth.clientCredentials(profile.auth ?? {})
    }
    return (
      KINDS[type] ?? {
        refused: describeProblem({ code: "auth-type-not-served", key: "auth.type" }),
      }
    )
  }

  static connectsWith(auth: TargetAuth): boolean {
    return auth.kind !== "oauth2"
  }

  static loginOf(auth: TargetAuth): LoginFields | undefined {
    if (auth.kind === "basic") {
      return BASIC_LOGIN
    }
    if (auth.kind !== "clientCredentials") {
      return undefined
    }
    return auth.clientId === undefined ? CLIENT_LOGIN : SECRET_ONLY
  }

  static signingInWith(dialect: Dialect): string {
    return EditorAuth.anyOf(SIGNING_IN.filter((type) => EditorAuth.takes(dialect, type)))
  }

  static authKeysWayOut(): string {
    const shared = CONNECTING.filter((type) =>
      EditorAuth.DIALECTS.every((dialect) => EditorAuth.takes(dialect, type)),
    )
    const own = EditorAuth.DIALECTS.flatMap((dialect) => {
      const types = EditorAuth.connectingIn(dialect).filter((type) => !shared.includes(type))
      return types.length === 0
        ? []
        : [`${EditorAuth.anyOf(types)} on ${flavorsOf(dialect).join(", ")}`]
    })
    return `This client connects with auth.type ${EditorAuth.anyOf([...shared, ...own])}: use one of them.`
  }

  static authTypeWayOut(profile: Profile, source: ProfileSource): string {
    const dialect = dialectOf(profile)
    const setType = `Set auth.type to ${EditorAuth.anyOf(EditorAuth.connectingIn(dialect))}`
    if (dialect !== CLI_DIALECT) {
      return `${setType}.`
    }
    if (authTypeOf(profile) !== "passthrough") {
      return `${setType}, ${EditorAuth.keepFor("CLI")}`
    }
    return source.isUserConfig() ? `${setType}.` : `${setType}, ${EditorAuth.keepFor("MCP server")}`
  }

  static headersWayOut(profile: Profile, source: ProfileSource): string {
    return source.isUserConfig() && dialectOf(profile) === CLI_DIALECT
      ? "Keep this profile for the CLI, and add a profile without headers for this client."
      : "Remove headers from this profile, or use one without them."
  }

  static oauthWayOut(dialect: Dialect): string {
    const withoutKeys = EditorAuth.connectingIn(dialect).filter(
      (type) => type !== SWITCHING_OAUTH_KEYS_OFF && !TAKING_OAUTH_KEYS.has(type),
    )
    const keep = dialect === CLI_DIALECT ? `, ${EditorAuth.keepFor("CLI")}` : "."
    return `Set auth.type to ${SWITCHING_OAUTH_KEYS_OFF}, or to ${EditorAuth.anyOf(withoutKeys)} without the OAuth keys${keep}`
  }

  private static clientCredentials(auth: ProfileAuth): TargetAuth | Refused {
    const endpoint = TokenEndpoint.read(auth.tokenEndpoint ?? "")
    if ("refused" in endpoint) {
      return endpoint
    }
    const { clientId, audience, scopes } = auth
    return {
      kind: "clientCredentials",
      tokenEndpoint: endpoint.url,
      ...(clientId === undefined ? {} : { clientId }),
      ...(audience === undefined ? {} : { audience }),
      ...(scopes === undefined ? {} : { scopes }),
    }
  }

  private static connectingIn(dialect: Dialect): AuthType[] {
    return CONNECTING.filter((type) => EditorAuth.takes(dialect, type))
  }

  private static takes(dialect: Dialect, type: AuthType): boolean {
    const types: readonly AuthType[] = DIALECT_AUTH_TYPES[dialect]
    return types.includes(type)
  }

  private static anyOf(types: readonly string[]): string {
    return new Intl.ListFormat("en", { type: "disjunction" }).format(types)
  }

  private static keepFor(surface: string): string {
    return `or keep this profile for the ${surface}.`
  }
}
