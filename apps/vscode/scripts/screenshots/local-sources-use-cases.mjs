import { enlargeList, goToInstanceOf, waitForPanel } from './panel-steps.mjs';
import { closeEditors, goToInstance, panelFrame, selectTab } from './vscode-driver.mjs';

async function showIncidentCard(window) {
  await selectTab(window, 'Incidents');
  await enlargeList(window);
  await panelFrame(window)
    .locator('.incident-card')
    .getByRole('button', { name: 'Open in model' })
    .waitFor({ timeout: 30_000 });
  await window.waitForTimeout(800);
}

export const LOCAL_SOURCES_USE_CASES = [
  {
    file: 'local-sources-model-and-code',
    title: 'What the local model configures on the failed element',
    shows:
      'The incident card of a worker task reads order-fulfillment.bpmn from the workspace: the model file, with Open in model and Open code (the task type only when it differs from the job type; mappings and error codes show the same way when the element has them). Open stacktrace and Retry sit in the strip only. Without a local model these facts and buttons are absent.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'ORD-10129');
      await waitForPanel(window);
      await showIncidentCard(window);
    },
  },
  {
    file: 'local-sources-open-code',
    title: 'From the incident to the worker',
    shows:
      'Open code opens ChargePaymentWorker.java as a tab over the panel at the line that subscribes to the task type charge-payment.',
    run: async (window) => {
      await panelFrame(window).getByRole('button', { name: 'Open code' }).click();
      await window
        .locator('.tab.active', { hasText: 'ChargePaymentWorker.java' })
        .waitFor({ timeout: 30_000 });
      await window.waitForTimeout(1200);
    },
  },
  {
    file: 'local-sources-model-differs',
    title: 'A local model that differs from the deployed version',
    shows:
      'The shipment of ORD-10142 runs on Shipment v1, but shipment.bpmn in the workspace adds a step: the card says that the local file differs from the deployed version.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstanceOf(window, 'ORD-10142', 'Shipment');
      await waitForPanel(window);
      await showIncidentCard(window);
    },
  },
  {
    file: 'local-sources-selected-element',
    title: 'Model and code of any element in the diagram',
    shows:
      'A click on Reserve stock in the diagram of ORD-10129 selects it: a code button on its shape, like the jump arrow of a call activity, opens ReserveStockWorker.java. Charge payment, which has the incident, shows its code button without a click.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'ORD-10129');
      await waitForPanel(window);
      await panelFrame(window)
        .locator('g.djs-element[data-element-id="Activity_ReserveStock"] .djs-hit')
        .click();
      await panelFrame(window)
        .locator('[data-code-for="Activity_ReserveStock"]')
        .waitFor({ timeout: 30_000 });
      await window.waitForTimeout(800);
    },
  },
];
