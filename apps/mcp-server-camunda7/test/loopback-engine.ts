import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

export interface LoopbackEngine {
  /** The engine's REST base, as `CAMUNDA_BASE_URL` or an engine entry's `baseUrl` takes it. */
  baseUrl: string
  close: () => Promise<void>
}

/**
 * An empty engine on 127.0.0.1: every count is 0, every list is empty. `camunda7_open_cockpit`
 * reads its start view, so a boot that opens the cockpit needs an engine that answers.
 */
export async function startLoopbackEngine(): Promise<LoopbackEngine> {
  const engine = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]
    res.setHeader("content-type", "application/json")
    res.end(path.endsWith("/count") ? '{"count":0}' : "[]")
  })
  await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve))
  const { port } = engine.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/engine-rest`,
    close: () => new Promise<void>((resolve) => engine.close(() => resolve())),
  }
}
