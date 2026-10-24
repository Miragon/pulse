/** Classifies what an operation does to engine state (read, write, delete, bulk). */

import { objectProperties, refName } from '../../src/catalog/schema.js';
import type {
  BodySpec,
  Effect,
  HttpMethod,
  ParamSpec,
  ResponseSpec,
} from '../../src/catalog/types.js';
import type { OpenApiDocument } from './openapi.js';

export interface EffectInput {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly params: readonly ParamSpec[];
  readonly body: BodySpec | undefined;
  readonly responses: readonly ResponseSpec[];
}

/** POST endpoints that only read: queries, counts, evaluations, filter executions, checks. */
const READ_ONLY_POST =
  /^(query|postQuery|evaluate|generate|validate|postExecute|checkPassword|verifyUser|getGroupInfo)/;

/** Operations that touch many resources although the generic rules do not detect it. */
export const BULK_OPERATIONS: ReadonlySet<string> = new Set([
  'deleteProcessDefinitionsByKey',
  'deleteProcessDefinitionsByKeyAndTenantId',
  'updateProcessDefinitionSuspensionStateByKey',
  'updateProcessDefinitionSuspensionStateByKeyAndTenantId',
  'updateProcessDefinitionSuspensionState',
  'updateSuspensionState',
  'updateSuspensionStateBy',
  'updateSuspensionStateJobDefinitions',
  'setExternalTaskRetries',
  'executeMigrationPlan',
  'executeModification',
  'restartProcessInstance',
  'cleanupAsync',
  'deleteTaskMetrics',
]);

/** Explicit effects where the HTTP method or the operationId is misleading. */
export const EFFECT_OVERRIDES: Readonly<Record<string, Effect>> = {
  clearIncidentAnnotation: 'write',
  clearAnnotationUserOperationLog: 'write',
  // POST /condition matches the read-only `evaluate` prefix but starts process instances
  evaluateCondition: 'write',
  // POST /task/{id}/identity-links/delete removes one identity link (command `delete`)
  deleteIdentityLink: 'delete',
};

/** Body properties that select many resources. */
const SELECTOR_PROPERTY = /(Query|Ids)$/;

function returnsBatch(responses: readonly ResponseSpec[]): boolean {
  return responses.some((response) => {
    const schema = response.schema;
    return schema !== undefined && refName(schema) === 'BatchDto';
  });
}

function selectsMany(input: EffectInput, spec: OpenApiDocument): boolean {
  if (input.body?.kind !== 'json' || input.params.some((param) => param.in === 'path')) {
    return false;
  }
  const properties = objectProperties(input.body.schema, spec.components?.schemas ?? {});
  return Object.keys(properties).some((name) => SELECTOR_PROPERTY.test(name));
}

export function isReadOnly(input: Pick<EffectInput, 'method' | 'operationId' | 'path'>): boolean {
  if (input.method === 'GET') return true;
  return (
    input.method === 'POST' &&
    (READ_ONLY_POST.test(input.operationId) || input.path.endsWith('/count'))
  );
}

export function classifyEffect(input: EffectInput, spec: OpenApiDocument): Effect {
  const override = EFFECT_OVERRIDES[input.operationId];
  if (override !== undefined) return override;
  if (isReadOnly(input)) return 'read';
  if (BULK_OPERATIONS.has(input.operationId) || returnsBatch(input.responses)) return 'bulk';
  if (selectsMany(input, spec)) return 'bulk';
  return input.method === 'DELETE' ? 'delete' : 'write';
}
