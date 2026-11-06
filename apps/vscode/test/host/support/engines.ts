import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { C8Adapter } from "../../../src/adapters/c8/index.js"
import { EngineCatalogue } from "../../../src/host/connections/engine-catalogue.js"
import type { EngineTarget } from "../../../src/host/connections/engine-target.js"

export const CATALOGUE = new EngineCatalogue([new C7Adapter(), new C8Adapter()])

export const LOCAL_TARGET: EngineTarget = {
  name: "local",
  engine: "c7",
  endpoint: "http://localhost:8080/engine-rest",
  auth: { kind: "none" },
  source: { kind: "default" },
}
