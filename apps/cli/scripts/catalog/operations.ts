/** Converts single OpenAPI operations into catalog entries (without command names). */

import type {
  BodySpec,
  HttpMethod,
  OperationSpec,
  ParamSpec,
  ParamType,
  ResponseKind,
  ResponseSpec,
  Schema,
} from '../../src/catalog/types.js';
import { jsonBody, multipartBody } from './bodies.js';
import { classifyEffect } from './effects.js';
import { assignFlags } from './flags.js';
import { flagName } from './naming.js';
import {
  type OpenApiDocument,
  type OpenApiOperation,
  type OpenApiParameter,
  type OpenApiPathItem,
  type Reference,
  resolve,
} from './openapi.js';

export type UnnamedOperation = Omit<OperationSpec, 'group' | 'name' | 'aliases'> & {
  readonly tag: string;
};

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE'];

/**
 * Path item keys that are not commands. OPTIONS operations only list the HATEOAS links a user may
 * follow (`availableOperations...`); they stay reachable with `operate api OPTIONS <path>`.
 */
const IGNORED_KEYS: ReadonlySet<string> = new Set([
  'options',
  'parameters',
  'summary',
  'description',
  'servers',
]);

/**
 * Integer query parameters the engine parses as Java `Integer` although the spec gives no format:
 * an out-of-range value would come back as a 404 `QueryParamException`, so they get int32 checks.
 */
const INT32_PARAMS: ReadonlySet<string> = new Set([
  'firstResult',
  'maxResults',
  'priority',
  'minPriority',
  'maxPriority',
]);

/** Endpoints that are not scoped to a named process engine. */
const ENGINE_INDEPENDENT_PATHS = new Set(['/engine', '/version']);

const TRUE_ONLY = /may only be `?true`?/i;

interface RawOperation {
  readonly path: string;
  readonly method: HttpMethod;
  readonly item: OpenApiPathItem;
  readonly operation: OpenApiOperation;
}

/** The HTTP method of a path item key; fails for keys the generator does not know. */
function methodOf(key: string, path: string): HttpMethod | undefined {
  if (IGNORED_KEYS.has(key)) return undefined;
  const method = METHODS.find((candidate) => candidate.toLowerCase() === key);
  if (method === undefined) throw new Error(`${path}: unsupported path item key "${key}"`);
  return method;
}

export function extractOperations(spec: OpenApiDocument): UnnamedOperation[] {
  const operations: UnnamedOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [key, operation] of Object.entries(item)) {
      const method = methodOf(key, path);
      if (method !== undefined) {
        operations.push(
          toOperation(spec, { path, method, item, operation: operation as OpenApiOperation }),
        );
      }
    }
  }
  return operations;
}

function toOperation(spec: OpenApiDocument, raw: RawOperation): UnnamedOperation {
  const { path, method, item, operation } = raw;
  const { operationId, tags } = operation;
  const tag = tags?.[0];
  if (operationId === undefined || tag === undefined) {
    throw new Error(`${method} ${path} needs an operationId and a tag`);
  }
  const params = toParams(spec, path, [
    ...(item.parameters ?? []),
    ...(operation.parameters ?? []),
  ]);
  const responses = toResponses(spec, operation);
  const body = assignFlags(params, toBody(spec, operation, operationId));
  const unwrap = unwrapProperty(spec, responses);
  return {
    operationId,
    tag,
    method,
    path,
    summary: clean(operation.summary ?? operationId),
    description: clean(operation.description ?? ''),
    deprecated: operation.deprecated === true,
    effect: classifyEffect({ operationId, method, path, params, body, responses }, spec),
    engineScoped: !ENGINE_INDEPENDENT_PATHS.has(path),
    params,
    ...(body === undefined ? {} : { body }),
    responses,
    ...(unwrap === undefined ? {} : { unwrap }),
  };
}

export function clean(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function toParams(
  spec: OpenApiDocument,
  path: string,
  raw: readonly (OpenApiParameter | Reference)[],
): ParamSpec[] {
  const byKey = new Map<string, OpenApiParameter>();
  for (const entry of raw) {
    const param = resolve(entry, spec.components?.parameters);
    byKey.set(`${param.in}:${param.name}`, param);
  }
  const params = [...byKey.values()].filter((p) => p.in === 'path' || p.in === 'query');
  const pathOrder = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  return params
    .map((param) => toParam(param))
    .sort((a, b) => sortKey(a, pathOrder) - sortKey(b, pathOrder));
}

function sortKey(param: ParamSpec, pathOrder: readonly (string | undefined)[]): number {
  return param.in === 'path' ? pathOrder.indexOf(param.name) : pathOrder.length;
}

function toParam(param: OpenApiParameter): ParamSpec {
  const schema = param.schema ?? {};
  const isPath = param.in === 'path';
  const type = paramType(schema);
  const description = clean(param.description ?? '');
  return {
    name: param.name,
    in: isPath ? 'path' : 'query',
    flag: isPath ? param.name : flagName(param.name),
    type,
    required: isPath || param.required === true,
    description,
    ...optionalParamFields(param, schema),
    ...(type === 'boolean' && TRUE_ONLY.test(description) ? { trueOnly: true } : {}),
  };
}

function paramFormat(param: OpenApiParameter, schema: Schema): string | undefined {
  if (typeof schema.format === 'string') return schema.format;
  return schema.type === 'integer' && INT32_PARAMS.has(param.name) ? 'int32' : undefined;
}

function optionalParamFields(
  param: OpenApiParameter,
  schema: Schema,
): Pick<ParamSpec, 'format' | 'enum'> {
  const format = paramFormat(param, schema);
  return {
    ...(format === undefined ? {} : { format }),
    ...(Array.isArray(schema.enum) ? { enum: schema.enum.map(String) } : {}),
  };
}

function paramType(schema: Schema): ParamType {
  const type = schema.type;
  if (type === 'integer' || type === 'number' || type === 'boolean' || type === 'object') {
    return type;
  }
  return 'string';
}

function toBody(
  spec: OpenApiDocument,
  operation: OpenApiOperation,
  operationId: string,
): BodySpec | undefined {
  if (operation.requestBody === undefined) return undefined;
  const body = resolve(operation.requestBody, spec.components?.requestBodies);
  const json = body.content?.['application/json']?.schema;
  if (json !== undefined) return jsonBody(spec, json);
  const multipart = body.content?.['multipart/form-data']?.schema;
  if (multipart !== undefined) return multipartBody(spec, multipart, operationId);
  throw new Error(`${operationId}: unsupported request body content types`);
}

function toResponses(spec: OpenApiDocument, operation: OpenApiOperation): ResponseSpec[] {
  return Object.entries(operation.responses ?? {})
    .filter(([status]) => status.startsWith('2'))
    .map(([status, entry]) => {
      const response = resolve(entry, spec.components?.responses);
      const contentTypes = Object.keys(response.content ?? {});
      const schema = response.content?.['application/json']?.schema;
      return {
        status: Number(status),
        kind: responseKind(contentTypes),
        contentTypes,
        description: clean(response.description ?? ''),
        ...(schema === undefined ? {} : { schema }),
      };
    });
}

export function responseKind(contentTypes: readonly string[]): ResponseKind {
  if (contentTypes.length === 0) return 'none';
  if (contentTypes.includes('application/json')) return 'json';
  if (contentTypes.some((type) => /octet-stream|image\/|\*\/\*/.test(type))) return 'binary';
  return 'text';
}

/** JSON responses of the shape `{ id, <name>Xml }` carry an XML document worth printing raw. */
function unwrapProperty(
  spec: OpenApiDocument,
  responses: readonly ResponseSpec[],
): string | undefined {
  const schema = responses.find((response) => response.kind === 'json')?.schema;
  if (schema === undefined) return undefined;
  const resolved = resolve<Schema>(schema, spec.components?.schemas);
  const names = Object.keys(resolved.properties ?? {});
  const xml = names.filter((name) => name.endsWith('Xml'));
  return xml.length === 1 && names.length === 2 && names.includes('id') ? xml[0] : undefined;
}
