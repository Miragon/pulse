/** Minimal OpenAPI 3.0 typings for the parts of the spec the catalog builder reads. */

import type { Schema } from '../../src/catalog/types.js';

export interface Reference {
  readonly $ref: string;
}

export interface OpenApiParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
  readonly description?: string;
  readonly schema?: Schema;
}

interface OpenApiMediaType {
  readonly schema?: Schema;
}

interface OpenApiRequestBody {
  readonly required?: boolean;
  readonly content?: Readonly<Record<string, OpenApiMediaType>>;
}

interface OpenApiResponse {
  readonly description?: string;
  readonly content?: Readonly<Record<string, OpenApiMediaType>>;
}

export interface OpenApiOperation {
  readonly operationId?: string;
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly description?: string;
  readonly deprecated?: boolean;
  readonly parameters?: readonly (OpenApiParameter | Reference)[];
  readonly requestBody?: OpenApiRequestBody | Reference;
  readonly responses?: Readonly<Record<string, OpenApiResponse | Reference>>;
}

export type OpenApiPathItem = Readonly<Record<string, unknown>> & {
  readonly parameters?: readonly (OpenApiParameter | Reference)[];
};

export interface OpenApiDocument {
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Readonly<Record<string, OpenApiPathItem>>;
  readonly components?: {
    readonly schemas?: Readonly<Record<string, Schema>>;
    readonly parameters?: Readonly<Record<string, OpenApiParameter>>;
    readonly requestBodies?: Readonly<Record<string, OpenApiRequestBody>>;
    readonly responses?: Readonly<Record<string, OpenApiResponse>>;
  };
}

export function isReference(value: unknown): value is Reference {
  return (
    typeof value === 'object' && value !== null && typeof (value as Reference).$ref === 'string'
  );
}

/** Name of the component a local `$ref` points to (`#/components/schemas/Foo` → `Foo`). */
export function refName(ref: string): string {
  const name = ref.split('/').at(-1);
  if (!ref.startsWith('#/components/') || name === undefined || name === '') {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  return name;
}

export function resolve<T>(
  value: T | Reference,
  components: Readonly<Record<string, T>> | undefined,
): T {
  if (!isReference(value)) return value;
  const target = components?.[refName(value.$ref)];
  if (target === undefined) throw new Error(`Unresolvable $ref: ${value.$ref}`);
  return target;
}
