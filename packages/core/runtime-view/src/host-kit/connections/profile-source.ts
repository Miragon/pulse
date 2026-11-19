import { basename } from "node:path"
import type { CredentialPolicy } from "@miragon/pulse-profile"

export type ProfileSourceKind = "file" | "user-config"

export class ProfileSource {
  static readonly PROJECT = new ProfileSource("file", "none")

  static readonly USER_CONFIG = new ProfileSource("user-config", "env-or-literal")

  private constructor(
    readonly kind: ProfileSourceKind,
    readonly credentials: CredentialPolicy,
  ) {}

  static of(kind: ProfileSourceKind): ProfileSource {
    return kind === "file" ? ProfileSource.PROJECT : ProfileSource.USER_CONFIG
  }

  isUserConfig(): boolean {
    return this.kind === "user-config"
  }

  label(path: string): string {
    return this.isUserConfig() ? "CLI config" : basename(path)
  }

  inSentence(path: string): string {
    return this.isUserConfig() ? "your CLI config" : basename(path)
  }
}
