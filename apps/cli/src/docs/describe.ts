/**
 * `operate describe`: everything an agent needs to call one operation — usage, arguments, options,
 * request body schema, responses and examples — as a JSON view and as readable plain text. Pure.
 */

import { expandSchema, type Schemas } from '../catalog/schema.js';
import type {
  Catalog,
  Effect,
  MultipartBodySpec,
  OperationSpec,
  ResponseKind,
  ResponseSpec,
  Schema,
} from '../catalog/types.js';
import { compact } from '../util.js';
import { examplesFor } from './examples.js';
import { type OptionDoc, operationArguments, operationOptions, usageLine } from './options.js';
import { fieldNames, propertyLines, schemaLabel } from './schema-text.js';
import { columns, paragraphLines, wrap, wrapCommand } from './text.js';

/** Reference depth of request body schemas and of response schemas. */
const BODY_DEPTH = 3;
const RESPONSE_DEPTH = 2;

interface DescribeArgument {
  readonly name: string;
  readonly description: string;
}

interface DescribeOption {
  /** Syntax, e.g. `--business-key <value>` or `--[no-]skip-io-mappings`. */
  readonly flag: string;
  readonly type: string;
  readonly required: boolean;
  readonly enum?: readonly string[];
  /** OpenAPI format of the parameter or body property, e.g. `int32` or `date-time`. */
  readonly format?: string;
  /** Present (true) for options that may be given more than once. */
  readonly repeatable?: boolean;
  readonly description: string;
}

interface DescribeBody {
  readonly contentType: 'application/json' | 'multipart/form-data';
  readonly schemaName?: string;
  /** Request schema, references expanded three levels deep. */
  readonly schema: unknown;
  /** Variable map options and the body property they fill, e.g. `{"--var": "variables"}`. */
  readonly variableFlags?: Readonly<Record<string, string>>;
}

interface DescribeResponse {
  readonly status: number;
  readonly kind: ResponseKind;
  readonly contentTypes: readonly string[];
  /** Response schema, references expanded two levels deep. */
  readonly schema?: unknown;
}

export interface DescribeView {
  /** Usage with positional arguments and required options, e.g. `operate task claim <id>`. */
  readonly command: string;
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  readonly effect: Effect;
  readonly deprecated: boolean;
  readonly arguments: readonly DescribeArgument[];
  readonly options: readonly DescribeOption[];
  readonly body?: DescribeBody;
  readonly responses: readonly DescribeResponse[];
  readonly examples: readonly string[];
}

/** OpenAPI formats of the parameters and body properties, by catalog flag. */
function formatsByFlag(operation: OperationSpec): Map<string, string | undefined> {
  const body = operation.body;
  const specs = body === undefined ? operation.params : [...operation.params, ...body.fields];
  return new Map(specs.map((spec) => [spec.flag, spec.format]));
}

function describeOption(
  option: OptionDoc,
  formats: Map<string, string | undefined>,
): DescribeOption {
  return {
    flag: option.syntax,
    type: option.type,
    required: option.required,
    ...compact({
      enum: option.enum,
      format: formats.get(option.flag),
      repeatable: option.kind === 'repeatable' ? true : undefined,
    }),
    description: option.description,
  };
}

function command(operation: OperationSpec, options: readonly OptionDoc[]): string {
  const required = options.filter((option) => option.required).map((option) => option.syntax);
  return [usageLine(operation).replace(' [options]', ''), ...required].join(' ');
}

/** The named multipart schema, or one built from the form fields. */
function multipartSchema(body: MultipartBodySpec, schemas: Schemas): unknown {
  if (body.schemaName !== undefined && Object.hasOwn(schemas, body.schemaName)) {
    return expandSchema({ $ref: `#/components/schemas/${body.schemaName}` }, schemas, BODY_DEPTH);
  }
  const properties = body.fields.map((field): [string, Schema] => [
    field.name,
    {
      type: field.type === 'boolean' ? 'boolean' : 'string',
      ...compact({ format: field.type === 'binary' ? 'binary' : field.format }),
      description: field.description,
    },
  ]);
  return { type: 'object', properties: Object.fromEntries(properties) };
}

function describeBody(operation: OperationSpec, schemas: Schemas): DescribeBody | undefined {
  const body = operation.body;
  if (body?.kind === 'multipart') {
    return {
      contentType: 'multipart/form-data',
      ...compact({ schemaName: body.schemaName }),
      schema: multipartSchema(body, schemas),
    };
  }
  if (body === undefined) return undefined;
  const variableFlags = body.variableMaps.map((map) => [`--${map.flag}`, map.name] as const);
  return {
    contentType: 'application/json',
    ...compact({ schemaName: body.schemaName }),
    schema: expandSchema(body.schema, schemas, BODY_DEPTH),
    ...(variableFlags.length > 0 ? { variableFlags: Object.fromEntries(variableFlags) } : {}),
  };
}

function describeResponse(response: ResponseSpec, schemas: Schemas): DescribeResponse {
  return {
    status: response.status,
    kind: response.kind,
    contentTypes: response.contentTypes,
    ...(response.schema === undefined
      ? {}
      : { schema: expandSchema(response.schema, schemas, RESPONSE_DEPTH) }),
  };
}

/** The JSON view of `operate describe` for one operation. */
export function describeOperation(operation: OperationSpec, catalog: Catalog): DescribeView {
  const options = operationOptions(operation, catalog.schemas);
  const formats = formatsByFlag(operation);
  const body = describeBody(operation, catalog.schemas);
  return {
    command: command(operation, options),
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    summary: operation.summary,
    description: operation.description,
    effect: operation.effect,
    deprecated: operation.deprecated,
    arguments: operationArguments(operation).map(({ name, description }) => ({
      name,
      description,
    })),
    options: options.map((option) => describeOption(option, formats)),
    ...(body === undefined ? {} : { body }),
    responses: operation.responses.map((response) => describeResponse(response, catalog.schemas)),
    examples: examplesFor(operation, catalog.schemas),
  };
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : ['', title, ...lines];
}

function descriptionLines(view: DescribeView): string[] {
  const facts = `${view.method} ${view.path} (effect: ${view.effect}, operationId: ${view.operationId})`;
  return [
    ...wrap(view.summary, '  '),
    ...wrap(facts, '  ', '    '),
    ...(view.deprecated ? ['  Deprecated: avoid in new scripts.'] : []),
    ...(view.description.trim() === '' ? [] : ['', ...paragraphLines(view.description)]),
  ];
}

function optionText(option: DescribeOption): string {
  const values = option.enum === undefined ? '' : ` One of: ${option.enum.join(', ')}.`;
  const description = option.required
    ? `Required. ${option.description.replace(/^Mandatory\./, '')}`
    : option.description;
  return `${description}${values}`;
}

function bodyLines(body: DescribeBody | undefined): string[] {
  if (body === undefined) return [];
  const flags = Object.entries(body.variableFlags ?? {}).map(([flag, name]) => `${flag} (${name})`);
  return [
    `  ${[body.contentType, ...(body.schemaName === undefined ? [] : [body.schemaName])].join(', ')}`,
    ...(flags.length === 0 ? [] : wrap(`Variable options: ${flags.join(', ')}`, '  ', '    ')),
    ...propertyLines(body.schema),
  ];
}

function responseLines(response: DescribeResponse): string[] {
  if (response.kind === 'none') return [`  ${response.status} no content`];
  const type = response.schema === undefined ? '' : `: ${schemaLabel(response.schema)}`;
  const fields = fieldNames(response.schema);
  return [
    ...wrap(
      `${response.status} ${response.kind} (${response.contentTypes.join(', ')})${type}`,
      '  ',
    ),
    ...(fields.length === 0 ? [] : wrap(`Fields: ${fields.join(', ')}`, '    ', '      ')),
  ];
}

/** Human readable `operate describe` output, wrapped at 100 columns, with a trailing newline. */
export function renderDescribeText(view: DescribeView): string {
  const lines = [
    'USAGE',
    ...wrapCommand(`${view.command} [options]`, '  '),
    ...section('DESCRIPTION', descriptionLines(view)),
    ...section(
      'ARGUMENTS',
      columns(view.arguments.map((arg) => [`<${arg.name}>`, arg.description])),
    ),
    ...section('OPTIONS', columns(view.options.map((option) => [option.flag, optionText(option)]))),
    ...section('BODY', bodyLines(view.body)),
    ...section('RESPONSES', view.responses.flatMap(responseLines)),
    ...section(
      'EXAMPLES',
      view.examples.flatMap((example) => wrapCommand(example, '  ')),
    ),
  ];
  return `${lines.join('\n')}\n`;
}
