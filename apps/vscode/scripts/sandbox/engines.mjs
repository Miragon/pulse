import { SHOP_DEV_SCENARIOS, SHOP_TEST_SCENARIOS } from './scenarios.mjs';

const PROJECT_MODELS = 'sandbox/src/main/resources/bpmn';
const DEPLOYED_MODELS = 'scripts/sandbox/deployed';

export const SHOP_DEV = {
  name: 'shop-dev',
  container: {
    name: 'pulse-sandbox-dev',
    image: 'docker.io/operaton/operaton:2.1.5',
    port: 18090,
    environment: { OPERATON_BPM_RUN_EXAMPLE_ENABLED: 'false' },
  },
  webApp: 'http://localhost:18090/operaton/app/cockpit/',
  deployments: [
    ['shipment', `${DEPLOYED_MODELS}/shipment.v1.bpmn`],
    ['return-handling', `${PROJECT_MODELS}/return-handling.bpmn`],
    ['order-fulfillment', `${DEPLOYED_MODELS}/order-fulfillment.v1.bpmn`],
    ['order-fulfillment', `${DEPLOYED_MODELS}/order-fulfillment.v2.bpmn`],
    ['order-fulfillment', `${PROJECT_MODELS}/order-fulfillment.bpmn`],
  ],
  scenarios: SHOP_DEV_SCENARIOS,
};

export const SHOP_TEST = {
  name: 'shop-test',
  container: {
    name: 'pulse-sandbox-test',
    image: 'docker.io/cibseven/cibseven:run-2.2.0',
    port: 18091,
    environment: {
      CAMUNDA_BPM_RUN_EXAMPLE_ENABLED: 'false',
      CAMUNDA_BPM_RUN_AUTH_AUTHENTICATION: 'basic',
    },
  },
  credentials: { username: 'demo', password: 'demo' },
  webApp: 'http://localhost:18091/camunda/app/cockpit/',
  deployments: [
    ['shipment', `${DEPLOYED_MODELS}/shipment.v1.bpmn`],
    ['return-handling', `${PROJECT_MODELS}/return-handling.bpmn`],
    ['order-fulfillment', `${PROJECT_MODELS}/order-fulfillment.bpmn`],
  ],
  scenarios: SHOP_TEST_SCENARIOS,
};

export const SANDBOX_ENGINES = [SHOP_DEV, SHOP_TEST];

export function endpointOf(engine) {
  return `http://localhost:${engine.container.port}/engine-rest`;
}
