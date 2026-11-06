import type { RequestAuth } from "./request-auth.js"

export class StaticAuth implements RequestAuth {
  private constructor(private readonly value: string | undefined) {}

  static none(): StaticAuth {
    return new StaticAuth(undefined)
  }

  static basic(username: string, password: string): StaticAuth {
    const pair = new TextEncoder().encode(`${username}:${password}`)
    const binary = Array.from(pair, (byte) => String.fromCharCode(byte)).join("")
    return new StaticAuth(`Basic ${btoa(binary)}`)
  }

  header(): Promise<string | undefined> {
    return Promise.resolve(this.value)
  }

  rejected(): boolean {
    return false
  }
}
