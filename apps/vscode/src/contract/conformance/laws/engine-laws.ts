import { RuntimeError } from '../../model/runtime-error.js';
import { Ensure } from '../ensure.js';
import { CASE, type ConformanceCase } from '../conformance-case.js';

const engineDescribesItself: ConformanceCase = {
  name: CASE.engineDescribesItself,
  async run(harness) {
    const engine = await harness.runtime.describeEngine();
    Ensure.that(engine.product.trim() !== '', this.name, 'the product is blank');
    Ensure.that(engine.version.trim() !== '', this.name, 'the version is blank');
  },
};

const unreachableEngine: ConformanceCase = {
  name: CASE.unreachableEngine,
  async run(harness) {
    const outcome = await harness.unreachableRuntime.listDefinitions().then(
      () => undefined,
      (error: unknown) => error,
    );
    Ensure.that(
      RuntimeError.is(outcome) && outcome.failure === 'unreachable',
      this.name,
      `expected RuntimeError "unreachable", got ${String(outcome)}`,
    );
  },
};

export const ENGINE_LAWS: readonly ConformanceCase[] = [engineDescribesItself, unreachableEngine];
