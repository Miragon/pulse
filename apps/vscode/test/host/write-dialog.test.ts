import type { WriteRequest } from '../../src/core/index.js';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WriteDialog } from '../../src/host/panels/write-dialog.js';

const shown = vi.hoisted(() => ({ details: [] as string[] }));

vi.mock('vscode', () => ({
  window: {
    showWarningMessage: (_title: string, options: { detail: string }) => {
      shown.details.push(options.detail);
      return Promise.resolve(undefined);
    },
  },
}));

const NO_LOGIN = 'No login: the engine records neither who nor why.';
const ENGINE = { name: 'shop-dev', environment: 'local', host: 'localhost:18090' };

function request(action: WriteRequest['action']): WriteRequest {
  return { action, title: 'Move?', facts: ['Reason: hotfix'], confirmLabel: 'Move' };
}

describe('the write dialog', () => {
  beforeEach(() => {
    shown.details = [];
  });

  test('says that the engine does not record who migrated when it has no login', async () => {
    await new WriteDialog(
      { action: 'migrateInstances', title: 'Migrate?', facts: [], confirmLabel: 'Migrate' },
      ENGINE,
    ).confirm('modal');
    await new WriteDialog(
      { action: 'migrateInstances', title: 'Migrate?', facts: [], confirmLabel: 'Migrate' },
      { ...ENGINE, identity: 'demo' },
    ).confirm('modal');

    expect(shown.details.map((detail) => detail.includes("doesn't record who migrated"))).toEqual([
      true,
      false,
    ]);
  });

  test.each([
    ['a move on an engine without login', 'moveToken', undefined, true],
    ['a move as a signed-in user', 'moveToken', 'demo', false],
    ['a retry on an engine without login', 'retryIncident', undefined, false],
  ] as const)(
    '%s says whether the engine keeps the reason',
    async (_case, action, identity, says) => {
      const engine = identity === undefined ? ENGINE : { ...ENGINE, identity };

      await new WriteDialog(request(action), engine).confirm('modal');

      expect(shown.details[0]?.includes(NO_LOGIN)).toBe(says);
    },
  );
});
