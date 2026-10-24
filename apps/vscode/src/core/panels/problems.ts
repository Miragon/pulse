import { RuntimeError, type RuntimeFailure } from '../../contract/index.js';
import type { EngineBadge, Problem } from '../protocol/index.js';

const TITLES: Readonly<Record<RuntimeFailure, (engine: string) => string>> = {
  unreachable: (engine) => `Can't reach ${engine}.`,
  unauthorized: (engine) => `${engine} rejected the credentials.`,
  forbidden: (engine) => `${engine} does not allow this request.`,
  misconfigured: (engine) => `The connection to ${engine} is not set up correctly.`,
  engineFailure: (engine) => `${engine} failed to answer.`,
  unexpectedResponse: (engine) => `${engine} answered in an unexpected way.`,
  rejected: (engine) => `${engine} refused the change.`,
};

const CONNECTION_FAILURES: ReadonlySet<RuntimeFailure> = new Set<RuntimeFailure>([
  'unreachable',
  'unauthorized',
  'forbidden',
  'misconfigured',
]);

export class Problems {
  static of(error: unknown, engine: EngineBadge): Problem {
    if (!RuntimeError.is(error)) {
      return {
        title: `Loading from ${engine.name} failed.`,
        detail: error instanceof Error ? error.message : String(error),
        canEditConnection: false,
      };
    }
    return {
      title: TITLES[error.failure](engine.name),
      detail: error.hint === undefined ? error.message : `${error.message} ${error.hint}`,
      canEditConnection: CONNECTION_FAILURES.has(error.failure),
      ...(error.failure === 'unauthorized' ? { needsCredentials: true } : {}),
    };
  }

  static notFound(what: string): Problem {
    return {
      title: `${what} was not found.`,
      detail: 'It may have been deleted.',
      canEditConnection: false,
    };
  }
}
