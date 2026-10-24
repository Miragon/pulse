import type { BulkRequest } from '../../src/core/index.js';
import { describe, expect, test, vi } from 'vitest';

const window = vi.hoisted(() => ({
  showWarningMessage: vi.fn(() => Promise.resolve('Migrate 2 instances')),
  showInputBox: vi.fn(() => Promise.resolve('2')),
}));

vi.mock('vscode', () => ({
  window,
  workspace: { getConfiguration: () => ({ inspect: () => undefined }) },
}));

const { WriteConfirmation } = await import('../../src/host/panels/write-confirmation.js');
const { WriteAudit } = await import('../../src/host/connections/write-audit.js');
const { LOCAL_TARGET } = await import('../../src/host/connections/engine-target.js');

const REQUEST: BulkRequest = {
  action: 'migrateInstances',
  title: 'Migrate 2 instances of Order fulfillment v1 to v2?',
  facts: [],
  confirmLabel: 'Migrate 2 instances',
  selected: 3,
  count: 2,
  countPrompt: 'Type 2 to migrate 2 instances',
  warning: "Migrating can't be undone; migrating back needs a plan of its own.",
  takesReason: false,
  reasonPrompt: '',
  auditFields: {
    source: 'order:1',
    target: 'order:2',
    mappings: 2,
    leftOut: 1,
    incidents: 1,
    mode: 'batch',
  },
};

describe('confirming a migration', () => {
  test('records the answer with the plan facts, the selection and the count', async () => {
    const lines: string[] = [];
    const confirmation = new WriteConfirmation(
      new WriteAudit({ info: (line) => lines.push(line) }),
    );
    const connection = {
      target: LOCAL_TARGET,
      badge: { name: LOCAL_TARGET.name, environment: 'local', host: 'localhost:8080' },
    } as unknown as Parameters<typeof confirmation.confirmBulk>[0];

    expect(await confirmation.confirmBulk(connection, REQUEST)).toEqual({});

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      / confirmation=typeCount answer=confirmed source=order:1 target=order:2 mappings=2 leftOut=1 incidents=1 mode=batch selected=3 skipped=1 count=2$/,
    );
  });
});
