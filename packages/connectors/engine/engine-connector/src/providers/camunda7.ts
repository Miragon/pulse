import type { EngineProvider } from "../engine-provider.js"
import { classicCockpitStrategy } from "./classic-cockpit.js"
import { createDialectClient } from "./create-client.js"

/** Routes verified against `camunda/camunda-bpm-platform` 7.24.0. */
export const camunda7Provider: EngineProvider = {
  flavor: "camunda7",
  branding: { displayName: "Camunda 7" },
  createClient: createDialectClient,
  cockpit: classicCockpitStrategy("/camunda/app/cockpit/default"),
}
