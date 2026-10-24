import { answer, closeEditors, panelFrame, runCommand, showPulse } from './vscode-driver.mjs';

const RESTING_POINTER = { x: 200, y: 860 };

export const quickPickRow = (window, text) =>
  window.locator('.quick-input-widget .monaco-list-row', { hasText: text });

export async function enlargeList(window) {
  const handle = panelFrame(window).locator('.split-layout__handle');
  await handle.focus();
  for (let step = 0; step < 5; step++) {
    await handle.press('ArrowUp');
  }
  await handle.blur();
}

export async function stripButton(window, name) {
  const button = panelFrame(window).locator('.strip-stack').getByRole('button', { name });
  await button.first().click();
}

export async function cardButton(window, name) {
  const card = panelFrame(window).locator('.incident-card');
  await card.getByRole('button', { name, exact: true }).first().click();
}

export async function waitForStrip(window, text, timeout = 30_000) {
  await panelFrame(window).locator('.strip-stack .status-strip', { hasText: text }).waitFor({
    timeout,
  });
}

export async function waitForPanel(window) {
  await panelFrame(window).locator('.context-bar', { hasText: 'As of' }).waitFor({
    timeout: 30_000,
  });
  await window.waitForTimeout(1500);
}

export async function restPointer(window) {
  await window.mouse.move(RESTING_POINTER.x, RESTING_POINTER.y);
  await window.waitForTimeout(600);
}

export async function restPointerOnDiagram(window) {
  await panelFrame(window)
    .locator('.diagram-host')
    .hover({ position: { x: 16, y: 16 } });
  await window.waitForTimeout(600);
}

export async function openDefinition(window) {
  await closeEditors(window);
  await showPulse(window);
  await window
    .getByRole('treeitem', { name: /^Order fulfillment, / })
    .first()
    .click();
  await waitForPanel(window);
}

export async function goToInstanceOf(window, key, processName) {
  await runCommand(window, 'Pulse: Go to Process Instance');
  await answer(window, key);
  await quickPickRow(window, processName).click({ timeout: 30_000 });
  await waitForPanel(window);
}

export async function switchEngine(window, name) {
  await runCommand(window, 'Pulse: Switch Engine');
  await answer(window, name);
  await window.locator('.statusbar-item', { hasText: name }).first().waitFor({ timeout: 15_000 });
}

export async function startColumnDrag(window, column, distance) {
  const grip = panelFrame(window).getByRole('separator', { name: `Resize column ${column}` });
  const box = await grip.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await window.mouse.move(x, y);
  await window.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await window.mouse.move(x + (distance * step) / 10, y);
  }
  await window.waitForTimeout(500);
}

export async function waitForEngineDefinitions(window, engine) {
  await window.waitForFunction(
    (name) => {
      const rows = [...globalThis.document.querySelectorAll('[role="treeitem"]')];
      const labels = rows.map((row) => row.getAttribute('aria-label') ?? '');
      const engineRow = labels.findIndex((label) => label.startsWith(`${name},`));
      return engineRow >= 0 && labels[engineRow + 1]?.startsWith('Order fulfillment,') === true;
    },
    engine,
    { timeout: 60_000 },
  );
}

export async function expectTooltip(locator, expected) {
  const tooltip = await locator.getAttribute('title');
  if (tooltip !== expected) {
    throw new Error(`Expected the tooltip "${expected}", found "${String(tooltip)}"`);
  }
}
