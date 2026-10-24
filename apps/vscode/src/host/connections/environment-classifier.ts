import type { Environment } from '../../core/protocol/index.js';
import type { EngineTarget } from './engine-target.js';
import type { EnvironmentSettings } from './pulse-settings.js';
import { TargetHosts } from './target-hosts.js';

const RANKS: Readonly<Record<Environment, number>> = {
  local: 0,
  test: 1,
  unclassified: 2,
  production: 3,
};

export class EnvironmentClassifier {
  static classify(target: EngineTarget, settings: EnvironmentSettings): Environment {
    const loopback = TargetHosts.isLoopback(target);
    const environmentIn = (scope: EnvironmentSettings['user']) =>
      EnvironmentClassifier.environmentOf(scope?.[target.name], loopback);
    const own = environmentIn(settings.user) ?? (loopback ? 'local' : 'unclassified');
    return settings.workspace.reduce<Environment>(
      (environment, scope) => EnvironmentClassifier.higher(environment, environmentIn(scope)),
      own,
    );
  }

  private static environmentOf(value: unknown, loopback: boolean): Environment | undefined {
    if (value !== 'local' && value !== 'test' && value !== 'production') {
      return undefined;
    }
    return value === 'local' && !loopback ? undefined : value;
  }

  private static higher(left: Environment, right: Environment | undefined): Environment {
    return right !== undefined && RANKS[right] > RANKS[left] ? right : left;
  }
}
