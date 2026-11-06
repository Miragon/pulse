import { readFileSync } from "node:fs"
import { SHOP_DEV_SCENARIOS, SHOP_TEST_SCENARIOS } from "./scenarios.mjs"

const SETTINGS = JSON.parse(
  readFileSync(new URL("../../test/adapters/c8/support/cluster-settings.json", import.meta.url)),
)
const PROJECT_MODELS = "sandbox-c8/src/main/resources/bpmn"
const DEPLOYED_MODELS = "scripts/sandbox-c8/deployed"
const SECURITY = "CAMUNDA_SECURITY_"
const AUTHORIZATION = `${SECURITY}INITIALIZATION_AUTHORIZATIONS_0_`

function user(index, name) {
  const prefix = `${SECURITY}INITIALIZATION_USERS_${index}_`
  return {
    [`${prefix}USERNAME`]: name,
    [`${prefix}PASSWORD`]: name,
    [`${prefix}NAME`]: name,
    [`${prefix}EMAIL`]: `${name}@example.com`,
  }
}

const DEMO_ADMIN = {
  ...user(0, "demo"),
  [`${SECURITY}INITIALIZATION_DEFAULTROLES_ADMIN_USERS_0`]: "demo",
}

const PULSE_READER = {
  ...user(1, "pulse"),
  [`${AUTHORIZATION}OWNER_TYPE`]: "USER",
  [`${AUTHORIZATION}OWNER_ID`]: "pulse",
  [`${AUTHORIZATION}RESOURCE_TYPE`]: "PROCESS_DEFINITION",
  [`${AUTHORIZATION}RESOURCE_ID`]: "*",
  [`${AUTHORIZATION}PERMISSIONS`]: "READ_PROCESS_DEFINITION,READ_PROCESS_INSTANCE,READ_USER_TASK",
}

export const SHOP_DEV = {
  name: "shop-dev",
  container: {
    name: "pulse-sandbox-c8-dev",
    image: SETTINGS.images.camunda,
    port: 18092,
    environment: {
      ...SETTINGS.storage.h2,
      [`${SECURITY}AUTHENTICATION_UNPROTECTEDAPI`]: "true",
      [`${SECURITY}AUTHORIZATIONS_ENABLED`]: "false",
      ...DEMO_ADMIN,
    },
  },
  login: "no login",
  deployments: [
    ["shipment", `${DEPLOYED_MODELS}/shipment.v1.bpmn`],
    ["return-handling", `${PROJECT_MODELS}/return-handling.bpmn`],
    ["order-fulfillment", `${DEPLOYED_MODELS}/order-fulfillment.v1.bpmn`],
    ["order-fulfillment", `${DEPLOYED_MODELS}/order-fulfillment.v2.bpmn`],
    ["order-fulfillment", `${PROJECT_MODELS}/order-fulfillment.bpmn`],
  ],
  scenarios: SHOP_DEV_SCENARIOS,
}

const SHOP_TEST = {
  name: "shop-test",
  container: {
    name: "pulse-sandbox-c8-test",
    image: SETTINGS.images.camunda,
    port: 18093,
    environment: {
      ...SETTINGS.storage.h2,
      [`${SECURITY}AUTHENTICATION_METHOD`]: "basic",
      [`${SECURITY}AUTHENTICATION_UNPROTECTEDAPI`]: "false",
      [`${SECURITY}AUTHORIZATIONS_ENABLED`]: "true",
      ...DEMO_ADMIN,
      ...PULSE_READER,
      ...user(2, "nobody"),
    },
  },
  seedCredentials: { username: "demo", password: "demo" },
  login: "login pulse / pulse (Set Credentials)",
  deployments: [
    ["shipment", `${DEPLOYED_MODELS}/shipment.v1.bpmn`],
    ["return-handling", `${PROJECT_MODELS}/return-handling.bpmn`],
    ["order-fulfillment", `${PROJECT_MODELS}/order-fulfillment.bpmn`],
  ],
  scenarios: SHOP_TEST_SCENARIOS,
}

export const SANDBOX_CLUSTERS = [SHOP_DEV, SHOP_TEST]

export function endpointOf(cluster) {
  return `http://localhost:${cluster.container.port}/v2`
}

export function operateOf(cluster) {
  return `http://localhost:${cluster.container.port}/operate`
}
