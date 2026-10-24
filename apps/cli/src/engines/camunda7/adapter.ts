import { createCamunda7RestClient } from "../../api/camunda7-rest/client.js"
import type { EngineAdapter } from "../../engine-port/engine-adapter.js"
import generated from "../../generated/catalog.camunda7.json" with { type: "json" }

export const camunda7: EngineAdapter = createCamunda7RestClient("camunda7", generated)
