/** Curated shortcut commands that call an operation with fixed body properties. */

import type { OperationSpec } from '../../src/catalog/types.js';

interface Preset {
  readonly operationId: string;
  readonly name: string;
  readonly summary: string;
  readonly body: Readonly<Record<string, unknown>>;
}

const SUSPENDABLE: readonly [operationId: string, noun: string][] = [
  ['updateSuspensionStateById', 'process instance'],
  ['updateProcessDefinitionSuspensionStateById', 'process definition'],
  ['updateJobSuspensionState', 'job'],
  ['updateSuspensionStateJobDefinition', 'job definition'],
  ['updateBatchSuspensionState', 'batch'],
];

export const PRESETS: readonly Preset[] = SUSPENDABLE.flatMap(([operationId, noun]) => [
  { operationId, name: 'suspend', summary: `Suspend a ${noun}`, body: { suspended: true } },
  { operationId, name: 'activate', summary: `Activate a ${noun}`, body: { suspended: false } },
]);

function withoutPresetFields(operation: OperationSpec, preset: Preset): OperationSpec['body'] {
  const body = operation.body;
  if (body?.kind !== 'json') return body;
  return { ...body, fields: body.fields.filter((field) => !(field.name in preset.body)) };
}

export function applyPresets(operations: readonly OperationSpec[]): OperationSpec[] {
  const presets = PRESETS.map((preset) => {
    const base = operations.find((operation) => operation.operationId === preset.operationId);
    if (base === undefined) throw new Error(`Preset for unknown operation ${preset.operationId}`);
    const body = withoutPresetFields(base, preset);
    return {
      ...base,
      name: preset.name,
      aliases: [],
      summary: preset.summary,
      description: `${preset.summary}. Shortcut for \`${base.group} ${base.name}\` with ${JSON.stringify(preset.body)}.`,
      ...(body === undefined ? {} : { body }),
      preset: preset.body,
    };
  });
  return [...operations, ...presets];
}
