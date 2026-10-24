import type { EngineBadge, Environment } from '../../core/protocol/index.js';
import type { EngineTarget } from './engine-target.js';

export class EngineBadges {
  static of(target: EngineTarget, environment: Environment, product?: string): EngineBadge {
    return {
      name: target.name,
      environment,
      host: new URL(target.endpoint).host,
      ...(product === undefined ? {} : { product }),
    };
  }
}
