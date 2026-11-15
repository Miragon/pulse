import type { EngineTarget } from "../../../src/host-kit/connections/engine-target.js"

export const LOCAL_TARGET: EngineTarget = {
  name: "local",
  engine: "c7",
  endpoint: "http://localhost:8080/engine-rest",
  auth: { kind: "none" },
  source: { kind: "default" },
}
