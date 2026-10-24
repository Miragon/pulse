const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

suite('Pulse in VS Code', () => {
  test('activates and registers every contributed command', async () => {
    const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
    assert.ok(extension, 'the extension is installed');
    await extension.activate();
    const registered = await vscode.commands.getCommands(true);
    for (const { command } of manifest.contributes.commands) {
      assert.ok(registered.includes(command), `${command} is registered`);
    }
  });

  test('shows the Engines view without any configuration', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.pulse');
    await vscode.commands.executeCommand('pulse.refresh');
  });
});
