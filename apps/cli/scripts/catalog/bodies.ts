/** Request body analysis: flags for scalar fields, typed variable maps and multipart fields. */

import {
  additionalPropertiesOf,
  deref,
  itemsOf,
  objectProperties,
  refName,
  schemaType,
} from '../../src/catalog/schema.js';
import type {
  BodyFieldSpec,
  JsonBodySpec,
  MultipartBodySpec,
  MultipartField,
  Schema,
  VariableMapSpec,
} from '../../src/catalog/types.js';
import type { OpenApiDocument } from './openapi.js';

/** Flags for the variable maps found in the spec. The generator fails on unknown map names. */
export const VARIABLE_MAP_FLAGS: Readonly<Record<string, string>> = {
  variables: 'var',
  processVariables: 'var',
  modifications: 'var',
  localVariables: 'local-var',
  processVariablesLocal: 'local-var',
  correlationKeys: 'correlation-key',
  localCorrelationKeys: 'local-correlation-key',
  processVariablesToTriggeredScope: 'triggered-scope-var',
};

const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
const VARIABLE_VALUE_SCHEMAS = new Set(['VariableValueDto']);

function schemasOf(spec: OpenApiDocument): Readonly<Record<string, Schema>> {
  return spec.components?.schemas ?? {};
}

function describe(schema: Schema): string {
  return typeof schema.description === 'string' ? schema.description.trim() : '';
}

function isVariableMap(property: Schema, spec: OpenApiDocument): boolean {
  const values = additionalPropertiesOf(property, schemasOf(spec));
  if (typeof values !== 'object') return false;
  const name = refName(values);
  return name !== undefined && VARIABLE_VALUE_SCHEMAS.has(name);
}

function variableMap(name: string): VariableMapSpec {
  const flag = VARIABLE_MAP_FLAGS[name];
  if (flag === undefined) throw new Error(`No flag defined for variable map "${name}"`);
  return { name, flag };
}

function scalarField(
  name: string,
  property: Schema,
  spec: OpenApiDocument,
): BodyFieldSpec | undefined {
  const schemas = schemasOf(spec);
  const type = schemaType(property, schemas);
  // a referenced scalar schema carries format, enum and description itself
  const resolved = deref(property, schemas);
  const description = describe(property) === '' ? describe(resolved) : describe(property);
  const base = { name, flag: '', description };
  const format = typeof resolved.format === 'string' ? { format: resolved.format } : {};
  const enumValues = Array.isArray(resolved.enum) ? { enum: resolved.enum.map(String) } : {};
  if (type !== undefined && SCALAR_TYPES.has(type)) {
    return { ...base, type: type as BodyFieldSpec['type'], ...format, ...enumValues };
  }
  const items = itemsOf(property, schemas);
  const itemType = items === undefined ? undefined : schemaType(items, schemas);
  if (type === 'array' && itemType !== undefined && SCALAR_TYPES.has(itemType)) {
    return { ...base, type: 'array', items: itemType as NonNullable<BodyFieldSpec['items']> };
  }
  return undefined;
}

export function jsonBody(spec: OpenApiDocument, schema: Schema): JsonBodySpec {
  const properties = objectProperties(schema, schemasOf(spec));
  const variableMaps: VariableMapSpec[] = [];
  const fields: BodyFieldSpec[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (isVariableMap(property, spec)) {
      variableMaps.push(variableMap(name));
      continue;
    }
    const field = scalarField(name, property, spec);
    if (field !== undefined) fields.push(field);
  }
  const schemaName = refName(schema);
  return {
    kind: 'json',
    ...(schemaName === undefined ? {} : { schemaName }),
    schema,
    fields,
    variableMaps,
    variableValue: schemaName !== undefined && VARIABLE_VALUE_SCHEMAS.has(schemaName),
  };
}

function multipartType(property: Schema): MultipartField['type'] {
  if (property.format === 'binary') return 'binary';
  return property.type === 'boolean' ? 'boolean' : 'string';
}

export function multipartBody(
  spec: OpenApiDocument,
  schema: Schema,
  operationId: string,
): MultipartBodySpec {
  const resources = operationId === 'createDeployment';
  const properties = objectProperties(schema, schemasOf(spec));
  const fields = Object.entries(properties)
    // deployment resources are passed as positional paths instead of the generic `data` field
    .filter(([name]) => !(resources && name === 'data'))
    .map(([name, property]): MultipartField => ({
      name,
      flag: '',
      type: multipartType(property),
      ...(typeof property.format === 'string' && property.format !== 'binary'
        ? { format: property.format }
        : {}),
      description: describe(property),
    }));
  const schemaName = refName(schema);
  return {
    kind: 'multipart',
    ...(schemaName === undefined ? {} : { schemaName }),
    fields,
    resources,
  };
}
