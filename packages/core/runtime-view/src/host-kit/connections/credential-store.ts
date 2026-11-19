import type { Credentials } from "./connection.js"
import type { EngineTarget } from "./engine-target.js"
import { TargetHosts } from "./target-hosts.js"

export interface SecretStorage {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
}

export interface Login {
  readonly identity?: string
  readonly secret: string
}

interface Fields {
  readonly identity: string
  readonly secret: string
  readonly origin: string
}

type SigningIn = "basic" | "clientCredentials"

const PREFIX = "pulse.connection"
const FIELDS: Readonly<Record<SigningIn, Fields>> = {
  basic: { identity: "username", secret: "password", origin: "origin" },
  clientCredentials: { identity: "clientId", secret: "clientSecret", origin: "clientOrigins" },
}
const NONE: Credentials = { kind: "none" }

export class CredentialStore {
  constructor(private readonly secrets: SecretStorage) {}

  async read(target: EngineTarget): Promise<Credentials> {
    const kind = CredentialStore.signingIn(target)
    if (kind === undefined) {
      return NONE
    }
    const fields = FIELDS[kind]
    const [stored, secret, origin] = await Promise.all([
      this.secrets.get(this.key(target, fields.identity)),
      this.secrets.get(this.key(target, fields.secret)),
      this.secrets.get(this.key(target, fields.origin)),
    ])
    const identity = CredentialStore.fileIdentity(target) ?? stored
    if (identity === undefined || secret === undefined) {
      return NONE
    }
    if (origin !== TargetHosts.credentialOrigins(target)) {
      return { kind: "savedForAnotherEndpoint", savedFor: origin ?? "an unknown endpoint" }
    }
    return kind === "basic"
      ? { kind, username: identity, password: secret }
      : { kind, clientId: identity, clientSecret: secret }
  }

  async write(target: EngineTarget, login: Login): Promise<void> {
    const kind = CredentialStore.signingIn(target)
    if (kind === undefined) {
      return
    }
    const fields = FIELDS[kind]
    if (login.identity !== undefined) {
      await this.secrets.store(this.key(target, fields.identity), login.identity)
    }
    await this.secrets.store(this.key(target, fields.secret), login.secret)
    await this.secrets.store(this.key(target, fields.origin), TargetHosts.credentialOrigins(target))
  }

  private key(target: EngineTarget, field: string): string {
    return `${PREFIX}.${this.secretScope(target)}.${field}`
  }

  private secretScope(target: EngineTarget): string {
    const scope = target.source.kind === "default" ? "default" : target.source.path
    return `${scope}::${target.name}`
  }

  private static signingIn(target: EngineTarget): SigningIn | undefined {
    const { kind } = target.auth
    return kind === "basic" || kind === "clientCredentials" ? kind : undefined
  }

  private static fileIdentity(target: EngineTarget): string | undefined {
    return target.auth.kind === "clientCredentials" ? target.auth.clientId : undefined
  }
}
