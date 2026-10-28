import { createCamunda7RestClient } from "../../api/camunda7-rest/client.js"
import type { EngineAdapter } from "../../engine-port/engine-adapter.js"
import generated from "../../generated/catalog.json" with { type: "json" }

export const operaton: EngineAdapter = createCamunda7RestClient("operaton", generated)
