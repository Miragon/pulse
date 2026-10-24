/** Builds the HTTP request for a catalog operation. Pure, no I/O. */

import { argumentName } from '../catalog/names.js';
import type { OperationSpec } from '../catalog/types.js';
import { OperateError, usageError } from '../errors.js';
import type { HttpRequest } from '../http/types.js';
import { mergeHeaders, stringifyJson } from '../util.js';
import type { TypedValue } from './variables.js';

export interface Target {
  /** REST API root, e.g. http://localhost:8080/engine-rest */
  readonly baseUrl: string;
  /** Named process engine; adds the /engine/{name} prefix. */
  readonly engine?: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface MultipartFile {
  readonly field: string;
  readonly fileName: string;
  readonly data: Blob;
}

export interface OperationInput {
  /** Values for the path parameters, in path order. */
  readonly pathArgs: readonly string[];
  /** Query values keyed by wire name; undefined entries are skipped. */
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly variables?: Readonly<Record<string, TypedValue>>;
  readonly multipart?: {
    readonly fields: Readonly<Record<string, string>>;
    readonly files: readonly MultipartFile[];
  };
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** `/engine/{name}` for a named engine and an engine scoped operation, else nothing. */
export function enginePrefix(engine: string | undefined, engineScoped: boolean): string {
  if (engine === undefined || engine === '' || !engineScoped) return '';
  return `/engine/${encodeURIComponent(engine)}`;
}

export function expandPath(operation: OperationSpec, pathArgs: readonly string[]): string {
  const pathParams = operation.params.filter((param) => param.in === 'path');
  if (pathArgs.length !== pathParams.length) {
    // splitArgs (and commander before it) check the arguments the user gave
    throw new OperateError(
      'INTERNAL',
      `${operation.operationId} needs ${pathParams.length} path argument(s), got ${pathArgs.length}`,
    );
  }
  return pathParams.reduce((path, param, index) => {
    const value = pathArgs[index];
    if (!value || value === '.' || value === '..') {
      throw usageError(`Argument <${argumentName(param.flag)}> must not be empty, "." or ".."`);
    }
    return path.replace(`{${param.name}}`, () => encodeURIComponent(value));
  }, operation.path);
}

export function queryString(operation: OperationSpec, query: OperationInput['query']): string {
  const search = new URLSearchParams();
  for (const param of operation.params) {
    const value = query[param.name];
    if (param.in === 'query' && value !== undefined) search.append(param.name, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export function acceptHeader(operation: OperationSpec): string {
  const types = new Set(operation.responses.flatMap((response) => response.contentTypes));
  if (types.size === 0 || types.has('application/json')) return 'application/json';
  return [...types].join(', ');
}

export function jsonBody(input: OperationInput): unknown {
  if (input.variables === undefined || Object.keys(input.variables).length === 0) return input.body;
  const base = (input.body ?? {}) as Record<string, unknown>;
  const existing = (base.variables ?? {}) as Record<string, unknown>;
  return { ...base, variables: { ...existing, ...input.variables } };
}

function multipartBody(input: OperationInput): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(input.multipart?.fields ?? {}))
    form.append(name, value);
  for (const file of input.multipart?.files ?? [])
    form.append(file.field, file.data, file.fileName);
  return form;
}

function body(operation: OperationSpec, input: OperationInput): Pick<HttpRequest, 'body'> {
  if (operation.body?.kind === 'multipart') return { body: multipartBody(input) };
  const json = jsonBody(input);
  const text = json === undefined ? undefined : stringifyJson(json);
  return text === undefined ? {} : { body: text };
}

export function buildRequest(
  operation: OperationSpec,
  input: OperationInput,
  target: Target,
): HttpRequest {
  const path = expandPath(operation, input.pathArgs);
  const url = joinUrl(
    target.baseUrl,
    `${enginePrefix(target.engine, operation.engineScoped)}${path}${queryString(operation, input.query)}`,
  );
  const payload = body(operation, input);
  const contentType =
    typeof payload.body === 'string' ? { 'Content-Type': 'application/json' } : {};
  return {
    method: operation.method,
    url,
    // case-insensitive: `-H 'accept: ...'` replaces the default Accept instead of adding a second one
    headers: mergeHeaders({ Accept: acceptHeader(operation), ...contentType }, target.headers),
    ...payload,
  };
}
