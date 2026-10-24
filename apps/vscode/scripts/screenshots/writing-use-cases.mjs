import {
  cardButton,
  enlargeList,
  openDefinition,
  restPointer,
  switchEngine,
  waitForEngineDefinitions,
  waitForStrip,
} from './panel-steps.mjs';
import {
  answer,
  closeEditors,
  goToInstance,
  MODIFIER,
  openFile,
  panelFrame,
  runCommand,
  selectTab,
  showPulse,
} from './vscode-driver.mjs';

export const WRITING_USE_CASES = [
  {
    file: 'edit-variable',
    title: 'Change a variable',
    shows:
      'The pencil opens an editor that keeps the engine type; text is edited without quotes, the old value stays visible.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'ORD-10130');
      await selectTab(window, 'Variables');
      await enlargeList(window);
      const frame = panelFrame(window);
      await frame.locator('tr', { hasText: 'cardExpiry' }).hover();
      await frame.getByRole('button', { name: 'Edit cardExpiry' }).click();
      const field = frame.locator('.variable-editor__field');
      await field.fill('12/2030');
      await window.waitForTimeout(600);
    },
  },
  {
    file: 'edit-null-variable',
    title: 'Set a variable that is null',
    shows:
      'A null variable asks which type to write, so 4117 stays text unless you choose a number.',
    run: async (window) => {
      const frame = panelFrame(window);
      await frame.getByRole('button', { name: 'Cancel' }).click();
      await frame.locator('tr', { hasText: 'couponCode' }).hover();
      await frame.getByRole('button', { name: 'Edit couponCode' }).click();
      await frame.locator('.variable-editor__field').fill('SPRING-4117');
      await window.waitForTimeout(600);
    },
    after: async (window) => {
      await panelFrame(window).getByRole('button', { name: 'Cancel' }).click();
      const frame = panelFrame(window);
      await frame.locator('tr', { hasText: 'cardExpiry' }).hover();
      await frame.getByRole('button', { name: 'Edit cardExpiry' }).click();
      await frame.locator('.variable-editor__field').fill('12/2030');
    },
  },
  {
    file: 'variable-changed-retry-now',
    title: 'Fix the data, then retry',
    shows:
      'After the change the panel confirms it and the incident strip right below offers Retry for the incident that waited for this fix.',
    run: async (window) => {
      await panelFrame(window).locator('.variable-editor__field').press(`${MODIFIER}+Enter`);
      await waitForStrip(window, 'Changed cardExpiry');
      await window.waitForTimeout(800);
    },
  },
  {
    file: 'model-entry-points',
    title: 'Runtime data from an open BPMN file',
    shows:
      'With a .bpmn open, the status bar shows its running instances and incidents on the active engine, and the editor title has a Show Runtime Data action.',
    run: async (window) => {
      await closeEditors(window);
      await openFile(window, 'shipment.bpmn');
      await window.locator('.statusbar-item', { hasText: 'running' }).waitFor({ timeout: 30_000 });
      await window.waitForTimeout(800);
    },
  },
  {
    file: 'model-drift',
    title: 'A model that differs from the engine',
    shows: 'The project adds Notify customer to the shipment, so no deployed version matches.',
    run: async (window) => {
      await runCommand(window, 'Pulse: Show Runtime Data for This Model');
      await waitForStrip(window, 'differs from every deployed version');
      await window.waitForTimeout(1200);
    },
  },
  {
    file: 'model-matches-deployed',
    title: 'A model that matches its deployed version',
    shows: 'order-fulfillment.bpmn is deployed as v3.',
    run: async (window) => {
      await closeEditors(window);
      await openFile(window, 'order-fulfillment.bpmn');
      await runCommand(window, 'Pulse: Show Runtime Data for This Model');
      await waitForStrip(window, 'matches the deployed v3');
      await window.waitForTimeout(1200);
    },
  },
  {
    file: 'credentials-set',
    title: 'An engine behind a login',
    shows:
      'After Set Credentials with demo / demo the TEST engine (CIB seven) shows its processes.',
    run: async (window) => {
      await closeEditors(window);
      await showPulse(window);
      await runCommand(window, 'Pulse: Set Credentials');
      await answer(window, 'shop-test');
      await answer(window, 'demo');
      await answer(window, 'demo');
      await waitForEngineDefinitions(window, 'shop-test');
      await restPointer(window);
      await window.waitForTimeout(900);
    },
  },
  {
    file: 'write-confirmation-test-engine',
    title: 'Writes on a TEST engine are confirmed',
    shows:
      'On shop-test the retry asks first and names instance, element, root cause, retries, engine, host and the identity it writes as.',
    run: async (window) => {
      await switchEngine(window, 'shop-test');
      await goToInstance(window, 'ORD-10008');
      await cardButton(window, 'Retry');
      await window.locator('.monaco-dialog-box').waitFor({ timeout: 15_000 });
      await window.waitForTimeout(600);
    },
    after: async (window) => {
      await window.keyboard.press('Escape');
      await switchEngine(window, 'shop-dev');
    },
  },
];

export const MOVING_USE_CASES = [
  {
    file: 'move-token-entry',
    title: 'Start a move on the diagram',
    shows:
      'A click on Charge payment, where the token of ORD-10131 waits with its incident, adds a move button under its shape, beside the code button.',
    run: async (window) => {
      await closeEditors(window);
      await goToInstance(window, 'ORD-10131');
      await panelFrame(window)
        .locator('g.djs-element[data-element-id="Activity_ChargePayment"] .djs-hit')
        .click();
      await panelFrame(window).locator('.move-entry').waitFor({ timeout: 15_000 });
      await window.waitForTimeout(600);
    },
  },
  {
    file: 'move-token',
    title: 'Move a token past a broken step',
    shows:
      'The move button opens the move panel: the diagram marks where the token may go, and once a target is picked the source shows −1, the target +1 and the review list what happens.',
    run: async (window) => {
      const frame = panelFrame(window);
      await frame.locator('.move-entry').click();
      await frame
        .locator('.move-panel select')
        .selectOption({ label: 'Await payment confirmation' });
      await frame.locator('.move-panel input').fill('Customer paid by bank transfer');
      await window.waitForTimeout(800);
    },
  },
  {
    file: 'move-token-confirm',
    title: 'A move is always confirmed',
    shows:
      'Even on the local engine a move asks first, names what happens and says that it cannot be undone.',
    run: async (window) => {
      await panelFrame(window)
        .locator('.move-panel')
        .getByRole('button', { name: 'Move…' })
        .click();
      await window.locator('.monaco-dialog-box').waitFor({ timeout: 15_000 });
      await window.waitForTimeout(600);
    },
    after: async (window) => {
      await window.keyboard.press('Escape');
    },
  },
];

async function openVersion(window, label) {
  const frame = panelFrame(window);
  const picker = frame.locator('select.version-picker__select');
  const value = await picker.locator('option', { hasText: label }).first().getAttribute('value');
  await picker.selectOption(value);
  await frame.locator('.context-bar', { hasText: 'As of' }).waitFor({ timeout: 30_000 });
  await window.waitForTimeout(1500);
}

export const MIGRATING_USE_CASES = [
  {
    file: 'migration-entry',
    title: 'Migrate selected instances',
    shows:
      'On an older version, the selection bar offers Migrate to version… next to Cancel instances…; the ids stay in Pulse, the webview names none.',
    run: async (window) => {
      await openDefinition(window);
      await openVersion(window, /^v2 /);
      await panelFrame(window)
        .getByRole('checkbox', { name: 'Select all shown instances' })
        .check();
      await panelFrame(window).locator('.selection-bar').waitFor({ timeout: 15_000 });
      await restPointer(window);
    },
  },
  {
    file: 'migration-plan',
    title: 'The engine proposes the mapping',
    shows:
      'A tab of its own shows both versions and the mapping the engine generated, how many of the selected instances wait at each element and whether the engine finds a problem.',
    run: async (window) => {
      await panelFrame(window).getByRole('button', { name: 'Migrate to version…' }).click();
      await panelFrame(window)
        .getByText(/map by id · no problems/)
        .waitFor({ timeout: 30_000 });
      await window.waitForTimeout(1500);
    },
  },
  {
    file: 'migration-unmapped',
    title: 'An element without a mapping where instances wait',
    shows:
      'Without a mapping for Check order, Pulse flags it on the diagram and in the table and offers to leave those instances out instead of letting the engine fail them.',
    run: async (window) => {
      await panelFrame(window)
        .getByRole('combobox', { name: 'Map Check order to' })
        .selectOption({ label: 'Not mapped' });
      await panelFrame(window).locator('.migration-actions__refusal').waitFor({ timeout: 30_000 });
      await restPointer(window);
    },
    after: async (window) => {
      await panelFrame(window)
        .getByRole('combobox', { name: 'Map Check order to' })
        .selectOption({ label: 'Check order' });
      await panelFrame(window)
        .getByText(/map by id · no problems/)
        .waitFor({ timeout: 30_000 });
    },
  },
  {
    file: 'migration-confirm',
    title: 'A migration is confirmed with its count',
    shows:
      'The dialog names the versions, the mapping, what changes and what stays, then asks to type the count, as a bulk cancel does.',
    run: async (window) => {
      await panelFrame(window)
        .getByRole('button', { name: /^Migrate \d+ instances…$/ })
        .click();
      await window.locator('.monaco-dialog-box').waitFor({ timeout: 15_000 });
      await window.waitForTimeout(600);
    },
    after: async (window) => {
      await window.keyboard.press('Escape');
    },
  },
];
