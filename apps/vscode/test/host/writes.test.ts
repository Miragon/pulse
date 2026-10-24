import { EngineLane } from '../../src/core/index.js';
import {
  DefinitionId,
  ElementId,
  BulkOperationId,
  IncidentId,
  InstanceId,
  RuntimeError,
  type ProcessCommands,
} from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { AuditedCommands } from '../../src/host/connections/audited-commands.js';
import { ConfirmationPolicy } from '../../src/host/connections/confirmation-policy.js';
import { ConnectionBuilder } from '../../src/host/connections/connection-builder.js';
import { EngineBulkRuns } from '../../src/host/connections/engine-bulk-runs.js';
import type { Credentials, EngineFactories } from '../../src/host/connections/connection.js';
import { LOCAL_TARGET, type EngineTarget } from '../../src/host/connections/engine-target.js';
import type { EnvironmentSettings } from '../../src/host/connections/pulse-settings.js';
import { WriteAudit } from '../../src/host/connections/write-audit.js';
import { WritePolicy } from '../../src/host/connections/write-policy.js';
import { NotificationText } from '../../src/host/notification-text.js';

const NO_LOGIN: Credentials = { kind: 'none' };
const LOGIN: Credentials = { kind: 'basic', username: 'demo', password: 'demo' };

function target(name: string, endpoint: string): EngineTarget {
  return { ...LOCAL_TARGET, name, endpoint };
}

const LOCAL = target('shop-dev', 'http://localhost:18090/engine-rest');
const DOCKER_HOST = target('docker', 'http://host.docker.internal:8080/engine-rest');
const REMOTE = {
  ...target('prod-eu', 'https://prod-eu.example.com/engine-rest'),
  auth: { kind: 'basic' as const },
};
const REMOTE_WITHOUT_LOGIN = target('staging', 'https://staging.example.com/engine-rest');

function settings(
  user?: Record<string, string>,
  ...workspace: Record<string, string>[]
): EnvironmentSettings {
  return { user, workspace };
}

describe('who may write', () => {
  test('reads only a valid user value and falls back to local engines only', () => {
    expect(WritePolicy.settingOf('enabled')).toBe('enabled');
    expect(WritePolicy.settingOf('everything')).toBe('localOnly');
    expect(WritePolicy.settingOf(undefined)).toBe('localOnly');
  });

  test.each([
    [LOCAL, 'localOnly', NO_LOGIN, true],
    [LOCAL, 'disabled', NO_LOGIN, false],
    [DOCKER_HOST, 'localOnly', NO_LOGIN, false],
    [REMOTE, 'localOnly', LOGIN, false],
    [REMOTE, 'enabled', NO_LOGIN, false],
    [REMOTE, 'enabled', LOGIN, true],
    [REMOTE_WITHOUT_LOGIN, 'enabled', LOGIN, false],
  ] as const)('%s with %s and %o may write: %s', (engine, setting, credentials, writable) => {
    expect(WritePolicy.access(engine, setting, credentials).writable).toBe(writable);
  });

  test('says why an engine stays read-only', () => {
    expect(WritePolicy.access(REMOTE, 'enabled', NO_LOGIN).note).toBe(
      'Read-only. prod-eu needs a login before Pulse writes, so that the engine records who changed what.',
    );
    expect(WritePolicy.access(REMOTE, 'localOnly', LOGIN).note).toContain(
      'pulse.writes to "enabled"',
    );
  });

  test('keeps a read-only profile read-only, even on this machine', () => {
    expect(WritePolicy.access({ ...LOCAL, readOnly: true }, 'enabled', NO_LOGIN)).toEqual({
      writable: false,
      note: 'Read-only. shop-dev is a read-only profile in .operate.json.',
    });
  });
});

function retryConfirmation(target: EngineTarget, given: EnvironmentSettings) {
  return ConfirmationPolicy.confirmationFor(target, given, 'retryIncident');
}

describe('how a write is confirmed', () => {
  test('lets a local engine write without a dialog and asks a remote one to type its host', () => {
    expect(retryConfirmation(LOCAL, settings())).toBe('none');
    expect(retryConfirmation(DOCKER_HOST, settings())).toBe('typeHost');
    expect(retryConfirmation(REMOTE, settings())).toBe('typeHost');
  });

  test('never lowers it for a remote engine, not even from the user settings', () => {
    expect(retryConfirmation(REMOTE, settings({ 'prod-eu': 'test' }))).toBe('typeHost');
    expect(retryConfirmation(REMOTE, settings(undefined, { 'prod-eu': 'test' }))).toBe('typeHost');
    expect(retryConfirmation(LOCAL, settings({ 'shop-dev': 'test' }))).toBe('modal');
  });

  test('lets a workspace raise the confirmation but never lower it', () => {
    expect(retryConfirmation(LOCAL, settings(undefined, { 'shop-dev': 'test' }))).toBe('modal');
    expect(retryConfirmation(LOCAL, settings(undefined, { 'shop-dev': 'production' }))).toBe(
      'typeHost',
    );
    expect(
      retryConfirmation(LOCAL, settings({ 'shop-dev': 'test' }, { 'shop-dev': 'local' })),
    ).toBe('modal');
  });

  test('always asks before a move, also on a local engine, and still types the host remotely', () => {
    expect(ConfirmationPolicy.confirmationFor(LOCAL, settings(), 'moveToken')).toBe('modal');
    expect(ConfirmationPolicy.confirmationFor(LOCAL, settings(), 'setVariable')).toBe('none');
    expect(ConfirmationPolicy.confirmationFor(REMOTE, settings(), 'moveToken')).toBe('typeHost');
    expect(
      ConfirmationPolicy.confirmationFor(LOCAL, settings({ 'shop-dev': 'local' }), 'moveToken'),
    ).toBe('modal');
    expect(
      ConfirmationPolicy.confirmationFor(
        LOCAL,
        settings({ 'shop-dev': 'production' }),
        'moveToken',
      ),
    ).toBe('typeHost');
  });

  test('ignores a remote engine claimed to be local', () => {
    expect(retryConfirmation(REMOTE, settings({ 'prod-eu': 'local' }))).toBe('typeHost');
    expect(retryConfirmation(REMOTE, settings({ 'prod-eu': 'nonsense' }))).toBe('typeHost');
  });

  test('always asks to type the count for a bulk write, and the host where a single write does', () => {
    expect(ConfirmationPolicy.bulkConfirmationOf('none')).toBe('typeCount');
    expect(ConfirmationPolicy.bulkConfirmationOf('modal')).toBe('typeCount');
    expect(ConfirmationPolicy.bulkConfirmationOf('typeHost')).toBe('typeCountHost');
  });
});

describe('the audit log', () => {
  function recording() {
    const lines: string[] = [];
    return { lines, log: { info: (line: string) => lines.push(line) } };
  }

  const engine = { target: LOCAL, environment: 'local' } as const;

  test('records every write with its target and result, never the value', async () => {
    const { lines, log } = recording();
    const commands: ProcessCommands = {
      retryIncident: () => Promise.resolve(),
      setVariable: () => Promise.reject(new RuntimeError('rejected', 'no')),
      moveToken: () => Promise.resolve(),
      cancelInstances: () => Promise.resolve(BulkOperationId('bulk-1')),
      migrateInstances: () => Promise.resolve(BulkOperationId('bulk-2')),
      stopBulkOperation: () => Promise.resolve(),
    };
    const audited = new AuditedCommands(commands, engine, new WriteAudit(log), true);

    await audited.retryIncident(IncidentId('incident-1'));
    await expect(
      audited.setVariable(InstanceId('instance-1'), {
        name: 'iban',
        valueJson: '"DE02 1203 0000"',
        type: 'String',
      }),
    ).rejects.toThrow('no');

    expect(lines).toEqual([
      'retryIncident engine=shop-dev origin=http://localhost:18090 environment=local incident=incident-1 result=done',
      'setVariable engine=shop-dev origin=http://localhost:18090 environment=local instance=instance-1 variable="iban" type=String bytes=16 result=rejected',
    ]);
    expect(lines.join('\n')).not.toContain('DE02');
  });

  test('records a move with its ends and the length of the reason, never the reason', async () => {
    const { lines, log } = recording();
    const commands = { moveToken: () => Promise.resolve() } as unknown as ProcessCommands;
    const move = {
      fromElementId: ElementId('Activity_Charge'),
      toElementId: ElementId('Activity "Pack"'),
      reason: ' Charged by hand ',
    };

    await new AuditedCommands(commands, engine, new WriteAudit(log), true).moveToken(
      InstanceId('instance-1'),
      move,
    );
    await new AuditedCommands(commands, engine, new WriteAudit(log), false).moveToken(
      InstanceId('instance-1'),
      move,
    );

    expect(lines).toEqual([
      'moveToken engine=shop-dev origin=http://localhost:18090 environment=local instance=instance-1 from="Activity_Charge" to="Activity \\"Pack\\"" reasonChars=15 result=done',
      'moveToken engine=shop-dev origin=http://localhost:18090 environment=local instance=instance-1 from="Activity_Charge" to="Activity \\"Pack\\"" reasonChars=15 oplog=none result=done',
    ]);
    expect(lines.join('\n')).not.toContain('Charged');
  });

  test('records a bulk cancel with every id, its count and the operation, never the reason', async () => {
    const { lines, log } = recording();
    const commands: ProcessCommands = {
      retryIncident: () => Promise.resolve(),
      setVariable: () => Promise.resolve(),
      moveToken: () => Promise.resolve(),
      cancelInstances: () => Promise.resolve(BulkOperationId('bulk-7')),
      migrateInstances: () => Promise.resolve(BulkOperationId('bulk-8')),
      stopBulkOperation: () => Promise.reject(new RuntimeError('rejected', 'gone')),
    };
    const audited = new AuditedCommands(commands, engine, new WriteAudit(log), true);
    const ids = Array.from({ length: 150 }, (_, index) => InstanceId(`instance-${index}`));

    await audited.cancelInstances(ids, { reason: 'secret ticket 4711' });
    await expect(audited.stopBulkOperation(BulkOperationId('bulk-7'))).rejects.toThrow('gone');

    const where = 'engine=shop-dev origin=http://localhost:18090 environment=local';
    expect(lines).toEqual([
      `cancelInstances ${where} part=1/2 ids=${ids.slice(0, 100).join(',')}`,
      `cancelInstances ${where} part=2/2 ids=${ids.slice(100).join(',')}`,
      `cancelInstances ${where} count=150 reason=given result=done bulk=bulk-7`,
      `stopBulkOperation ${where} bulk=bulk-7 result=rejected`,
    ]);
    expect(lines.join('\n')).not.toContain('4711');
  });

  test('records the outcome of a bulk run with its counts', () => {
    const { lines, log } = recording();
    new WriteAudit(log).recordOutcome(engine, {
      action: 'cancelInstances',
      operationId: 'bulk-7',
      phase: 'stopped',
      total: 10,
      remaining: 4,
      failed: 0,
    });
    expect(lines).toEqual([
      'cancelInstancesOutcome engine=shop-dev origin=http://localhost:18090 environment=local bulk=bulk-7 phase=stopped done=6 remaining=4',
    ]);
  });

  test('records a migration with its plan, every id and the operation, then its outcome', async () => {
    const { lines, log } = recording();
    const commands = {
      migrateInstances: () => Promise.resolve(BulkOperationId('bulk-9')),
    } as unknown as ProcessCommands;
    const plan = {
      sourceDefinitionId: DefinitionId('order:1'),
      targetDefinitionId: DefinitionId('order:2'),
      mappings: [
        { sourceElementId: ElementId('Review'), targetElementId: ElementId('Review') },
        { sourceElementId: ElementId('Charge'), targetElementId: ElementId('Pay') },
      ],
    };
    const audit = new WriteAudit(log);

    await new AuditedCommands(commands, engine, audit, false).migrateInstances(plan, [
      InstanceId('instance-1'),
      InstanceId('instance-2'),
    ]);
    audit.recordOutcome(engine, {
      action: 'migrateInstances',
      operationId: 'bulk-9',
      phase: 'finished',
      total: 5,
      remaining: 1,
      arrived: 3,
      failed: 1,
    });

    const where = 'engine=shop-dev origin=http://localhost:18090 environment=local';
    expect(lines).toEqual([
      `migrateInstancesPlan ${where} part=1/1 map=Review>Review,Charge>Pay`,
      `migrateInstances ${where} part=1/1 ids=instance-1,instance-2`,
      `migrateInstances ${where} source=order:1 target=order:2 mappings=2 count=2 oplog=none result=done bulk=bulk-9`,
      `migrateInstancesOutcome ${where} bulk=bulk-9 phase=finished migrated=3 stillOnSource=1 ended=1 failed=1`,
    ]);
  });

  test('records the confirmation that was shown and the answer', () => {
    const { lines, log } = recording();
    new WriteAudit(log).recordConfirmation(engine, {
      action: 'setVariable',
      confirmation: 'modal',
      confirmed: false,
    });
    expect(lines).toEqual([
      'confirm setVariable engine=shop-dev origin=http://localhost:18090 environment=local confirmation=modal answer=cancelled',
    ]);
  });
});

describe('the bulk runs of an engine', () => {
  test('are shared by every profile of the same endpoint, however it is written', () => {
    const runs = new EngineBulkRuns();
    const same = runs.of(target('shop-dev', 'http://LOCALHOST:18090/engine-rest/'));

    expect(runs.of(LOCAL)).toBe(same);
    expect(runs.of(REMOTE)).not.toBe(same);
  });
});

describe('a connection', () => {
  const commands: ProcessCommands = {
    retryIncident: () => Promise.resolve(),
    setVariable: () => Promise.resolve(),
    moveToken: () => Promise.resolve(),
    cancelInstances: () => Promise.resolve(BulkOperationId('bulk-1')),
    migrateInstances: () => Promise.resolve(BulkOperationId('bulk-2')),
    stopBulkOperation: () => Promise.resolve(),
  };

  function factories(withCommands: boolean): EngineFactories {
    return {
      runtime: () => ({}) as never,
      commands: () => (withCommands ? commands : undefined),
      webUi: () => undefined,
    };
  }

  const LOCAL_ONLY = { writes: 'localOnly', live: undefined, lane: new EngineLane() } as const;
  const builder = (withCommands: boolean) =>
    new ConnectionBuilder(factories(withCommands), new WriteAudit({ info: () => undefined }));

  test('carries audited commands and the identity it logs in with when it may write', () => {
    const connection = builder(true).build(
      { ...LOCAL, auth: { kind: 'basic' } },
      LOGIN,
      'local',
      LOCAL_ONLY,
    );
    expect(connection.commands).toBeDefined();
    expect(connection.identity).toBe('demo');
    expect(connection.badge.access?.writable).toBe(true);
  });

  test('stays read-only when the policy or the adapter says no', () => {
    expect(builder(true).build(REMOTE, LOGIN, 'production', LOCAL_ONLY).commands).toBeUndefined();
    const noAdapter = builder(false).build(LOCAL, NO_LOGIN, 'local', LOCAL_ONLY);
    expect(noAdapter.commands).toBeUndefined();
    expect(noAdapter.badge.access).toEqual({
      writable: false,
      note: 'Read-only. Pulse cannot change data on this engine yet.',
    });
  });

  test('turns live updates on for local engines and leaves production to the user', () => {
    expect(builder(false).build(LOCAL, NO_LOGIN, 'local', LOCAL_ONLY).live.setting).toBe('on');
    expect(builder(false).build(REMOTE, LOGIN, 'production', LOCAL_ONLY).live.setting).toBe('off');
  });

  test('names the web UI of its engine in the badge when the adapter knows one', () => {
    const cockpit = {
      name: 'Cockpit',
      overviewUrl: () => '',
      instanceUrl: () => '',
      definitionUrl: () => '',
    };
    const withWebUi = new ConnectionBuilder(
      { ...factories(false), webUi: () => cockpit },
      new WriteAudit({ info: () => undefined }),
    ).build(LOCAL, NO_LOGIN, 'local', LOCAL_ONLY);

    expect(withWebUi.webUi).toBe(cockpit);
    expect(withWebUi.badge.webUi).toBe('Cockpit');
    expect(builder(false).build(LOCAL, NO_LOGIN, 'local', LOCAL_ONLY).badge).not.toHaveProperty(
      'webUi',
    );
  });
});

describe('text shown in a dialog', () => {
  test('loses control and direction characters', () => {
    expect(NotificationText.printable('evil‮gnp.exe\nnext')).toBe('evil gnp.exe next');
  });
});
