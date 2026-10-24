import { RuntimeError } from '../../../contract/index.js';
import type { ActivityInstanceView } from '../engine-cli/index.js';

const MULTI_INSTANCE_BODY = '#multiInstanceBody';

export interface SourceTokenRef {
  readonly field: 'activityInstanceId' | 'transitionInstanceId';
  readonly id: string;
}

export class SourceToken {
  static in(tree: ActivityInstanceView, elementId: string): SourceTokenRef {
    const scopes = SourceToken.scopesOf(tree);
    if (scopes.some((scope) => scope.activityId === `${elementId}${MULTI_INSTANCE_BODY}`)) {
      throw new RuntimeError(
        'rejected',
        `${elementId} runs as multi-instance; Pulse moves only a single token.`,
      );
    }
    const tokens = [
      ...scopes
        .filter((scope) => scope !== tree && scope.activityId === elementId)
        .map((scope) => ({ field: 'activityInstanceId', id: scope.id }) as const),
      ...scopes
        .flatMap((scope) => scope.childTransitionInstances)
        .filter((transition) => transition.activityId === elementId)
        .map((transition) => ({ field: 'transitionInstanceId', id: transition.id }) as const),
    ];
    const [token, ...more] = tokens;
    if (token === undefined) {
      throw new RuntimeError('rejected', `No token waits at ${elementId}.`);
    }
    if (more.length > 0) {
      throw new RuntimeError(
        'rejected',
        `${tokens.length} tokens wait at ${elementId}; Pulse moves only a single token.`,
      );
    }
    return token;
  }

  private static scopesOf(scope: ActivityInstanceView): ActivityInstanceView[] {
    return [scope, ...scope.childActivityInstances.flatMap((child) => SourceToken.scopesOf(child))];
  }
}
