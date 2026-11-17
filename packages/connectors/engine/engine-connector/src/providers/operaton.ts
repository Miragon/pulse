import type { C7EngineProvider } from "../engine-provider.js"
import { classicCockpitStrategy } from "./classic-cockpit.js"
import { createDialectClient } from "./create-client.js"

/** Routes verified against `operaton/operaton` 2.1.2. */
export const operatonProvider: C7EngineProvider = {
  flavor: "operaton",
  dialect: "c7",
  branding: { displayName: "Operaton" },
  createClient: createDialectClient,
  cockpit: classicCockpitStrategy("/operaton/app/cockpit/default"),
}
