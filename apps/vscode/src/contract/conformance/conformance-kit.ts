import type { CommandConformanceCase, PrepareCommandHarness } from './command-harness.js';
import type { ConformanceCase } from './conformance-case.js';
import type { PrepareHarness } from './harness.js';
import { BULK_LAWS } from './laws/bulk-laws.js';
import { CALL_LAWS } from './laws/call-laws.js';
import { COMMAND_LAWS } from './laws/command-laws.js';
import { DEFINITION_LAWS } from './laws/definition-laws.js';
import { DETAIL_LAWS } from './laws/detail-laws.js';
import { ENGINE_LAWS } from './laws/engine-laws.js';
import { INCIDENT_LAWS } from './laws/incident-laws.js';
import { INSTANCE_LAWS } from './laws/instance-laws.js';
import { MIGRATION_LAWS } from './laws/migration-laws.js';
import { MIGRATION_PLAN_LAWS } from './laws/migration-plan-laws.js';
import { MOVE_LAWS } from './laws/move-laws.js';

export type TestRunner = (name: string, body: () => Promise<void>) => unknown;

interface Law<Harness> {
  readonly name: string;
  run(harness: Harness): Promise<void>;
}

export class ConformanceKit {
  constructor(private readonly test: TestRunner) {}

  static runtimeLaws(): readonly ConformanceCase[] {
    return [
      ...ENGINE_LAWS,
      ...DEFINITION_LAWS,
      ...CALL_LAWS,
      ...INSTANCE_LAWS,
      ...DETAIL_LAWS,
      ...INCIDENT_LAWS,
      ...MIGRATION_PLAN_LAWS,
    ];
  }

  static commandLaws(): readonly CommandConformanceCase[] {
    return [...COMMAND_LAWS, ...MOVE_LAWS, ...BULK_LAWS, ...MIGRATION_LAWS];
  }

  registerRuntimeLaws(prepare: PrepareHarness): void {
    this.register(ConformanceKit.runtimeLaws(), prepare);
  }

  registerCommandLaws(prepare: PrepareCommandHarness): void {
    this.register(ConformanceKit.commandLaws(), prepare);
  }

  private register<Harness>(laws: readonly Law<Harness>[], prepare: () => Promise<Harness>): void {
    let prepared: Promise<Harness> | undefined;
    for (const law of laws) {
      this.test(`conformance: ${law.name}`, async () => {
        prepared ??= prepare();
        await law.run(await prepared);
      });
    }
  }
}
