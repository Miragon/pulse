import { ElementId, InstanceId, RuntimeError } from '../../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { fakeCommands, type FakeRoute } from './support/fake-engine-cli.js';
import { fixture, WORLD_IDS } from './support/fixtures.js';

const REVIEW = InstanceId(WORLD_IDS.review);
const CHARGE = InstanceId(WORLD_IDS.charge);
const REVIEW_ORDER = ElementId('Activity_ReviewOrder');
const CHARGE_PAYMENT = ElementId('Activity_ChargePayment');
const TREE = ['process-instance', 'get-activity-instance-tree'];
const MODIFY = ['process-instance', 'modify'];
const REASON = 'Charged by hand after the outage';
const ACCEPTED: FakeRoute = { command: MODIFY, stdout: '' };

function treeOf(name: string): FakeRoute {
  return { command: TREE, stdout: fixture(name) };
}

function treeWith(children: readonly object[], transitions: readonly object[] = []): FakeRoute {
  const root = { id: 'root', activityId: 'pulse-order:1:x' };
  const tree = { ...root, childActivityInstances: children, childTransitionInstances: transitions };
  return { command: TREE, stdout: JSON.stringify(tree) };
}

function failure(exitCode: number, code: string, message: string): Partial<FakeRoute> {
  return { exitCode, stderr: JSON.stringify({ error: { code, exitCode, message } }) };
}

function cancelOf(input: string | undefined): unknown {
  const body = JSON.parse(input ?? '{}') as { instructions: readonly unknown[] };
  return body.instructions[1];
}

async function failureOf(attempt: Promise<void>): Promise<string> {
  return attempt.then(
    () => 'succeeded',
    (error: unknown) => (error instanceof RuntimeError ? error.failure : 'raw error'),
  );
}

describe('moving a token', () => {
  test('starts the target and then cancels exactly the token read from the tree, in one request on stdin', async () => {
    const { commands, cli } = fakeCommands([treeOf('activity-instances-review.json'), ACCEPTED]);

    await commands.moveToken(REVIEW, {
      fromElementId: REVIEW_ORDER,
      toElementId: REVIEW_ORDER,
      reason: ` ${REASON} `,
    });

    expect(cli.commands()).toEqual([
      [...TREE, REVIEW],
      [...MODIFY, '--body', '-', '--', REVIEW],
    ]);
    expect(JSON.parse(cli.invocations[1]?.input ?? '{}')).toEqual({
      annotation: REASON,
      instructions: [
        { type: 'startBeforeActivity', activityId: 'Activity_ReviewOrder' },
        {
          type: 'cancel',
          activityInstanceId: 'Activity_ReviewOrder:63d7bdc3-cd7f-11f1-86d2-667bc3771e0d',
        },
      ],
    });
  });

  test('cancels a token that waits for its job as a transition instance', async () => {
    const { commands, cli } = fakeCommands([treeOf('activity-instances-charge.json'), ACCEPTED]);

    await commands.moveToken(CHARGE, {
      fromElementId: CHARGE_PAYMENT,
      toElementId: REVIEW_ORDER,
      reason: REASON,
    });

    expect(cancelOf(cli.invocations[1]?.input)).toEqual({
      type: 'cancel',
      transitionInstanceId: '63da7d5d-cd7f-11f1-86d2-667bc3771e0d',
    });
  });

  test('reads the tree read-only and writes without skipping listeners or mappings', async () => {
    const { commands, cli } = fakeCommands([treeOf('activity-instances-review.json'), ACCEPTED]);

    await commands.moveToken(REVIEW, {
      fromElementId: REVIEW_ORDER,
      toElementId: REVIEW_ORDER,
      reason: REASON,
    });

    expect(cli.invocations[0]?.environment.OPERATE_READ_ONLY).toBe('1');
    expect(cli.invocations[1]?.environment).not.toHaveProperty('OPERATE_READ_ONLY');
    expect(cli.invocations[1]?.args.join(' ')).not.toMatch(
      /--skip|--yes|--annotation|--no-validate/,
    );
    expect(cli.invocations[1]?.input).not.toMatch(/skip/i);
  });

  test.each([
    ['no token', treeWith([])],
    [
      'two tokens',
      treeWith([
        { id: 'a1', activityId: 'Activity_ReviewOrder' },
        { id: 'a2', activityId: 'Activity_ReviewOrder' },
      ]),
    ],
    [
      'an activity and a transition instance',
      treeWith(
        [{ id: 'a1', activityId: 'Activity_ReviewOrder' }],
        [{ id: 't1', activityId: 'Activity_ReviewOrder' }],
      ),
    ],
    [
      'a multi-instance body',
      treeWith([
        {
          id: 'body',
          activityId: 'Activity_ReviewOrder#multiInstanceBody',
          childActivityInstances: [{ id: 'a1', activityId: 'Activity_ReviewOrder' }],
        },
      ]),
    ],
  ])('is rejected before any write when the source holds %s', async (_what, tree) => {
    const { commands, cli } = fakeCommands([tree]);

    expect(
      await failureOf(
        commands.moveToken(REVIEW, {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason: REASON,
        }),
      ),
    ).toBe('rejected');
    expect(cli.commands()).toEqual([[...TREE, REVIEW]]);
  });

  test('finds a single token inside a sub-process', async () => {
    const { commands, cli } = fakeCommands([
      treeWith([
        {
          id: 'sub',
          activityId: 'SubProcess_Check',
          childActivityInstances: [{ id: 'a1', activityId: 'Activity_ReviewOrder' }],
        },
      ]),
      ACCEPTED,
    ]);

    await commands.moveToken(REVIEW, {
      fromElementId: REVIEW_ORDER,
      toElementId: REVIEW_ORDER,
      reason: REASON,
    });

    expect(cancelOf(cli.invocations[1]?.input)).toEqual({
      type: 'cancel',
      activityInstanceId: 'a1',
    });
  });

  test.each([
    '',
    '   ',
    'x'.repeat(501),
    'two\nlines',
    'bell\u0007',
    'rtl‮override',
    'line separator',
  ])('is rejected before calling the engine for the reason %j', async (reason) => {
    const { commands, cli } = fakeCommands([]);

    expect(
      await failureOf(
        commands.moveToken(REVIEW, {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason,
        }),
      ),
    ).toBe('rejected');
    expect(cli.invocations).toEqual([]);
  });

  test('is rejected without a write when the instance is not running', async () => {
    const { commands, cli } = fakeCommands([
      {
        command: TREE,
        ...failure(5, 'NOT_FOUND', 'Process instance with id 63d65e9e does not exist'),
      },
    ]);

    expect(
      await failureOf(
        commands.moveToken(REVIEW, {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason: REASON,
        }),
      ),
    ).toBe('rejected');
    expect(cli.commands()).toEqual([[...TREE, REVIEW]]);
  });

  test('refuses an instance id that could smuggle more ids into the command', async () => {
    const { commands, cli } = fakeCommands([]);

    expect(
      await failureOf(
        commands.moveToken(InstanceId('a,b'), {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason: REASON,
        }),
      ),
    ).toBe('rejected');
    expect(cli.invocations).toEqual([]);
  });

  test('keeps element ids out of the command line', async () => {
    const odd = ElementId('Aktivität_Prüfen --yes');
    const { commands, cli } = fakeCommands([treeWith([{ id: 'a1', activityId: odd }]), ACCEPTED]);

    await commands.moveToken(REVIEW, { fromElementId: odd, toElementId: odd, reason: REASON });

    expect(cli.invocations.flatMap((call) => call.args).join(' ')).not.toContain(odd);
  });

  test('maps an engine refusal to "rejected" and keeps the reason out of the message', async () => {
    const { commands } = fakeCommands([
      treeOf('activity-instances-review.json'),
      {
        command: MODIFY,
        ...failure(6, 'HTTP_CLIENT_ERROR', `Cannot start Unknown_Element: ${REASON}`),
      },
    ]);

    const attempt = commands.moveToken(REVIEW, {
      fromElementId: REVIEW_ORDER,
      toElementId: ElementId('Unknown_Element'),
      reason: REASON,
    });

    await expect(attempt).rejects.toMatchObject({
      failure: 'rejected',
      message: 'Cannot start Unknown_Element: ‹value›',
    });
  });

  test('reports a malformed tree as an unexpected response', async () => {
    const { commands } = fakeCommands([{ command: TREE, stdout: '{"id":"root"}' }]);

    expect(
      await failureOf(
        commands.moveToken(REVIEW, {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason: REASON,
        }),
      ),
    ).toBe('unexpectedResponse');
  });
});
