import {
  cardButton,
  enlargeList,
  openDefinition,
  quickPickRow,
  restPointer,
  restPointerOnDiagram,
  stripButton,
  waitForPanel,
  waitForStrip,
} from './panel-steps.mjs';
import {
  answer,
  closeEditors,
  goToInstance,
  MODIFIER,
  panelFrame,
  runCommand,
  selectTab,
  showPulse,
} from './vscode-driver.mjs';

export const READING_USE_CASES = [
  {
    file: 'engines-at-a-glance',
    title: 'Engines at a glance',
    shows:
      'The Engines view with LOCAL, TEST and an unreachable PROD engine, each process with its running instances and open incidents; the status bar names the active engine.',
    run: async (window) => {
      await showPulse(window);
      for (const name of [/^shop-test/, /^prod-eu/]) {
        await window.getByRole('treeitem', { name }).first().locator('.monaco-tl-twistie').click();
      }
      await window.getByRole('treeitem', { name: /Can't reach prod-eu/ }).waitFor({
        timeout: 60_000,
      });
      await restPointer(window);
      await window.waitForTimeout(2400);
    },
  },
  {
    file: 'definition-overview',
    title: 'A process definition with its runtime',
    shows:
      'The deployed diagram with waiting and incident badges per element, the version picker, the docked notice about older versions and the running instances under one filter bar with scopes, counts, search and the legend button.',
    run: openDefinition,
  },
  {
    file: 'definition-filter-by-element',
    title: 'Filter the instances by an element',
    shows:
      'Clicking Charge payment in the diagram filters the list to the instances there; the filter bar shows the element as a chip and the scope counts follow it.',
    run: async (window) => {
      await panelFrame(window)
        .locator('[data-element-id="Activity_ChargePayment"]')
        .first()
        .click({ force: true });
      await panelFrame(window).locator('.filter-chip', { hasText: 'Charge payment' }).waitFor();
      await restPointer(window);
      await window.waitForTimeout(900);
    },
  },
  {
    file: 'definition-older-version',
    title: 'Instances on an older version',
    shows: 'Show v2 from the notice switches the diagram, the badges and the list to version 2.',
    run: async (window) => {
      await openDefinition(window);
      await stripButton(window, 'Show v2');
      await window.waitForTimeout(2500);
    },
  },
  {
    file: 'instance-incident-root-cause',
    title: 'An instance with an incident',
    shows:
      'A single incident needs no strip: its card holds root cause, job, retries, model and incident id with Stacktrace, Open in model, Open code and Retry; the header names the instance, its definition and when it started.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'ORD-10129');
      await window.waitForTimeout(1500);
    },
  },
  {
    file: 'stacktrace-with-source-links',
    title: 'The stack trace as a document',
    shows:
      'Stacktrace opens a read-only document at the last Caused by; frames of the project link to their sources (underlined while Cmd/Ctrl is held).',
    run: async (window) => {
      await cardButton(window, 'Stacktrace');
      await window
        .locator('.monaco-editor .view-lines', { hasText: 'Caused by:' })
        .first()
        .waitFor({
          timeout: 30_000,
        });
      await window
        .locator('.monaco-editor .view-line', { hasText: 'CardGateway.java' })
        .first()
        .hover();
      await window.keyboard.down(MODIFIER);
      await window.waitForTimeout(900);
    },
    after: async (window) => {
      await window.keyboard.up(MODIFIER);
    },
  },
  {
    file: 'retry-waiting-for-worker',
    title: 'Retry an incident of a worker task',
    shows:
      'Retry on a local engine runs without a dialog; three seconds later the panel says honestly that the task waits for a worker to fetch it again.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'ORD-10131');
      await cardButton(window, 'Retry');
      await waitForStrip(window, 'Waiting at');
      await window.waitForTimeout(800);
    },
  },
  {
    file: 'retry-failed-again',
    title: 'A retry that fails again',
    shows:
      'The panel keeps checking for up to a minute; when the job executor runs the Groovy job again and it fails, it says "Failed again" with the root cause.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'ORD-10135');
      await cardButton(window, 'Retry');
      await waitForStrip(window, 'Failed again', 75_000);
      await window.waitForTimeout(800);
    },
  },
  {
    file: 'same-business-key-picker',
    title: 'Go to an instance by business key',
    shows: 'The order and its shipment share ORD-10142, so Go to Process Instance asks which one.',
    run: async (window) => {
      await closeEditors(window);
      await runCommand(window, 'Pulse: Go to Process Instance');
      await answer(window, 'ORD-10142');
      await quickPickRow(window, 'Order fulfillment').waitFor({ timeout: 30_000 });
    },
  },
  {
    file: 'incident-in-called-instance',
    title: 'An incident inside a called instance',
    shows:
      'The call activity is marked dashed; the card says it is located in the called shipment, links to it and retries there.',
    run: async (window) => {
      await quickPickRow(window, 'Order fulfillment').click();
      await waitForPanel(window);
    },
  },
  {
    file: 'wait-states',
    title: 'Every kind of wait state',
    shows: 'A return waits for a message, a signal and a 14-day timer at once.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'RET-5006');
      await selectTab(window, 'Waiting');
    },
  },
  {
    file: 'variables-typed-and-scoped',
    title: 'Variables with their engine type and scope',
    shows:
      'Engine types, a Long beyond 2^53 kept exact, JSON, null, a 3.6 KB note and a task-local variable scoped to Check order.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'ORD-10119');
      await selectTab(window, 'Variables');
      await enlargeList(window);
      await restPointerOnDiagram(window);
    },
  },
];
