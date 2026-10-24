import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron } from 'playwright';

const MAC_INSTALLATION = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const WINDOW = { width: 1600, height: 1000 };
const USER_SETTINGS = {
  'window.dialogStyle': 'custom',
  'workbench.startupEditor': 'none',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'chat.disableAIFeatures': true,
  'git.openRepositoryInParentFolders': 'never',
  'workbench.tips.enabled': false,
  'editor.minimap.enabled': false,
};

async function vscodeExecutable() {
  if (process.env.PULSE_VSCODE_EXECUTABLE !== undefined) {
    return process.env.PULSE_VSCODE_EXECUTABLE;
  }
  return existsSync(MAC_INSTALLATION) ? MAC_INSTALLATION : downloadAndUnzipVSCode('stable');
}

async function userDataWithSettings() {
  const userData = await mkdtemp(join(tmpdir(), 'pulse-shots-'));
  await mkdir(join(userData, 'User'), { recursive: true });
  await writeFile(join(userData, 'User', 'settings.json'), JSON.stringify(USER_SETTINGS));
  return userData;
}

export async function launchVsCode(workspace) {
  const userData = await userDataWithSettings();
  const app = await electron.launch({
    executablePath: await vscodeExecutable(),
    args: [
      resolve(workspace),
      `--extensionDevelopmentPath=${resolve('packages/extension')}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${join(userData, 'extensions')}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--new-window',
    ],
  });
  const window = await app.firstWindow();
  window.on('crash', () => console.log('\nThe VS Code window crashed.'));
  window.on('close', () => console.log('\nThe VS Code window closed.'));
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, WINDOW);
  return {
    window,
    close: async () => {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    },
  };
}

export function panelFrame(window) {
  return window.frameLocator('iframe.webview.ready').last().frameLocator('iframe#active-frame');
}

export async function quickInput(window, shortcut) {
  await window.keyboard.press('Escape');
  await window.locator('.statusbar').click({ position: { x: 800, y: 8 } });
  await window.keyboard.press(shortcut);
  const input = window.locator('.quick-input-widget input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  return input;
}

export async function runCommand(window, title) {
  const input = await quickInput(window, `${MODIFIER}+Shift+P`);
  await input.fill(`>${title}`);
  await window.waitForTimeout(400);
  await input.press('Enter');
}

export async function answer(window, text) {
  const input = window.locator('.quick-input-widget input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.fill(text);
  await window.waitForTimeout(300);
  await input.press('Enter');
}

export async function openFile(window, fileName) {
  const input = await quickInput(window, `${MODIFIER}+P`);
  await input.fill(fileName);
  await window.waitForTimeout(800);
  await input.press('Enter');
  await window.locator('.tab.active', { hasText: fileName }).waitFor({ timeout: 30_000 });
}

export async function showPulse(window) {
  const container = window.locator('.part.sidebar .composite.title', { hasText: 'Pulse' });
  if (!(await container.isVisible().catch(() => false))) {
    await window.locator('.activitybar [aria-label^="Pulse"]').first().click();
  }
  await window
    .getByRole('treeitem', { name: /^Order fulfillment, / })
    .first()
    .waitFor({
      timeout: 60_000,
    });
}

export async function goToInstance(window, key) {
  await runCommand(window, 'Pulse: Go to Process Instance');
  await answer(window, key);
  await panelFrame(window).locator('.context-bar', { hasText: 'As of' }).waitFor({
    timeout: 30_000,
  });
}

export async function selectTab(window, name) {
  await panelFrame(window)
    .getByRole('tab', { name: new RegExp(`^${name}`) })
    .click();
  await window.waitForTimeout(600);
}

export async function closeEditors(window) {
  await runCommand(window, 'View: Close All Editors');
  await window.waitForTimeout(400);
}

export { MODIFIER };
