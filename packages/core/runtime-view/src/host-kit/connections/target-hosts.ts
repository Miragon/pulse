import type { EngineTarget } from "./engine-target.js"

const LOOPBACK: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"])

export class TargetHosts {
  static isLoopback(target: EngineTarget): boolean {
    return LOOPBACK.has(new URL(target.endpoint).hostname)
  }
}
