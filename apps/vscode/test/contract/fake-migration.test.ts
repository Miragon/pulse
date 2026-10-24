import { describe, expect, test } from 'vitest';
import { DefinitionId, ElementId, RuntimeError } from '../../src/contract/index.js';
import { WORLD_ELEMENT } from '../../src/contract/conformance/index.js';
import { FakeEngine, FakeWorld } from '../../src/contract/fake/index.js';

const REVIEW = ElementId(WORLD_ELEMENT.reviewOrder);
const CHARGE = ElementId(WORLD_ELEMENT.chargePayment);

function engine() {
  const { state, world } = FakeWorld.seedForCommands();
  return {
    engine: new FakeEngine(state),
    world,
    source: world.definitionIds['order@1'],
    target: world.definitionIds['order@2'],
  };
}

async function failureOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => 'succeeded',
    (error: unknown) => (RuntimeError.is(error) ? error.failure : 'raw error'),
  );
}

describe('the fake migration', () => {
  test('names unknown elements, a second mapping of one source and incompatible kinds', async () => {
    const { engine: fake, source, target } = engine();

    const check = await fake.checkMigration({
      sourceDefinitionId: source,
      targetDefinitionId: target,
      mappings: [
        { sourceElementId: ElementId('Nope'), targetElementId: REVIEW },
        { sourceElementId: REVIEW, targetElementId: ElementId('Nope') },
        { sourceElementId: REVIEW, targetElementId: REVIEW },
        { sourceElementId: REVIEW, targetElementId: REVIEW },
        { sourceElementId: CHARGE, targetElementId: REVIEW },
      ],
    });

    expect(check.problems.map((problem) => problem.message)).toEqual([
      'Source element Nope does not exist.',
      'Target element Nope does not exist.',
      `${REVIEW} is mapped twice.`,
      `${REVIEW} is mapped twice.`,
      'A serviceTask cannot become a userTask.',
    ]);
  });

  test('rejects a proposal or a migration to a version it does not know', async () => {
    const { engine: fake, world, source } = engine();
    const unknown = DefinitionId('pulse-order:9');

    expect(await failureOf(fake.proposeMigration(source, unknown))).toBe('rejected');
    expect(
      await failureOf(
        fake.migrateInstances(
          { sourceDefinitionId: source, targetDefinitionId: unknown, mappings: [] },
          world.migrationInstanceIds.whole,
        ),
      ),
    ).toBe('rejected');
  });

  test('fails an instance that ended between the submit and its turn, and keeps the operation', async () => {
    const { engine: fake, world, source, target } = engine();
    const plan = await fake.proposeMigration(source, target);
    const [stay] = world.migrationInstanceIds.stay;

    const migration = await fake.migrateInstances(plan, [stay!]);
    await fake.getBulkOperation(await fake.cancelInstances([stay!]));
    const operation = await fake.getBulkOperation(migration);

    expect(operation).toMatchObject({ state: 'running', total: 1, completed: 0, failed: 1 });
    expect(await fake.getBulkFailures(migration)).toEqual([
      { instanceId: stay, reason: `Instance ${stay} does not run on ${source}.` },
    ]);
  });
});
