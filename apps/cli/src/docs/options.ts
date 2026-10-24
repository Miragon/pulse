/**
 * How catalog entries become command line syntax. The single model behind option registration,
 * `--help` and `operate describe`, so the three can never disagree.
 */

import { argumentName } from '../catalog/names.js';
import { DEFAULT_PAGE_SIZE, isPaginated } from '../catalog/rules.js';
import { requiredProperties, type Schemas } from '../catalog/schema.js';
import type {
  BodyFieldSpec,
  JsonBodySpec,
  MultipartBodySpec,
  MultipartField,
  OperationSpec,
  ParamSpec,
} from '../catalog/types.js';

/**
 * value: `--x <value>`; boolean: `--x` (true) and `--no-x` (false); presence: only `--x` (true);
 * negated: only `--no-x` (false); repeatable: `--x <value>` given any number of times.
 */
export type OptionKind = 'value' | 'boolean' | 'presence' | 'negated' | 'repeatable';

type OptionSource =
  | 'workflow'
  | 'query'
  | 'body-field'
  | 'variables'
  | 'body'
  | 'value'
  | 'validate'
  | 'all'
  | 'base-dir'
  | 'multipart'
  | 'file';

export interface OptionDoc {
  /** Catalog flag without dashes, e.g. `business-key`. Key of the value in `CommandValues.flags`. */
  readonly flag: string;
  /** Syntax as shown to users, e.g. `--business-key <value>` or `--[no-]skip-io-mappings`. */
  readonly syntax: string;
  readonly kind: OptionKind;
  /** Placeholder for the option argument, e.g. `<value>`; absent for flags without an argument. */
  readonly valueName?: string;
  readonly type: string;
  readonly required: boolean;
  readonly enum?: readonly string[];
  readonly source: OptionSource;
  readonly description: string;
}

export interface ArgumentDoc {
  readonly name: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly description: string;
}

const VALUE_NAMES: Readonly<Record<string, string>> = {
  integer: '<n>',
  number: '<number>',
  'date-time': '<date-time>',
  array: '<values>',
};

export const VARIABLE_HELP =
  'name=value (auto typed: true/false, integers, decimals, null, else string) or name:Type=value ' +
  '(String, Integer, Short, Long, Double, Boolean, Date, Json, Xml, Null; Date accepts the ' +
  'date-time forms, e.g. 2024-05-01 or 2024-05-01T10:00:00+02:00); repeatable';

/** First paragraph of a spec description as one line, markdown links and emphasis reduced to text. */
export function summarize(description: string): string {
  const paragraph = description.split(/\n\s*\n/)[0] ?? '';
  return paragraph
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function typeName(type: string, format: string | undefined): string {
  return format === 'date-time' ? 'date-time' : type;
}

function valueOption(base: Omit<OptionDoc, 'syntax' | 'kind' | 'valueName'>): OptionDoc {
  const valueName = VALUE_NAMES[base.type] ?? '<value>';
  return { ...base, kind: 'value', valueName, syntax: `--${base.flag} ${valueName}` };
}

function booleanOption(base: Omit<OptionDoc, 'syntax' | 'kind'>, presenceOnly: boolean): OptionDoc {
  if (presenceOnly || base.flag.startsWith('no-')) {
    return { ...base, kind: 'presence', syntax: `--${base.flag}` };
  }
  return { ...base, kind: 'boolean', syntax: `--[no-]${base.flag}` };
}

function withEnum(enumValues: readonly string[] | undefined): Pick<OptionDoc, 'enum'> {
  return enumValues === undefined ? {} : { enum: enumValues };
}

function queryOption(param: ParamSpec): OptionDoc {
  const base = {
    flag: param.flag,
    type: typeName(param.type, param.format),
    required: param.required,
    source: 'query' as const,
    description: summarize(param.description),
    ...withEnum(param.enum),
  };
  return param.type === 'boolean'
    ? booleanOption(base, param.trueOnly === true)
    : valueOption(base);
}

function fieldOption(field: BodyFieldSpec, required: boolean): OptionDoc {
  const base = {
    flag: field.flag,
    type: typeName(field.type, field.format),
    required,
    source: 'body-field' as const,
    description: summarize(field.description),
    ...withEnum(field.enum),
  };
  if (field.type === 'boolean') return booleanOption(base, false);
  if (field.type !== 'array') return valueOption(base);
  return {
    ...base,
    kind: 'repeatable',
    valueName: '<values>',
    syntax: `--${field.flag} <values>`,
    description: `${base.description} Comma separated, repeatable.`.trim(),
  };
}

function jsonBodyOptions(body: JsonBodySpec, schemas: Schemas | undefined): OptionDoc[] {
  const required = new Set(schemas === undefined ? [] : requiredProperties(body.schema, schemas));
  const variables = body.variableMaps.map((map): OptionDoc => ({
    flag: map.flag,
    syntax: `--${map.flag} <name=value>`,
    kind: 'repeatable',
    valueName: '<name=value>',
    type: 'variables',
    required: false,
    source: 'variables',
    description: `Entry of "${map.name}": ${VARIABLE_HELP}.`,
  }));
  const value: OptionDoc[] = body.variableValue
    ? [
        {
          flag: 'value',
          syntax: '--value <value>',
          kind: 'value',
          valueName: '<value>',
          type: 'string',
          required: false,
          source: 'value',
          description:
            'Variable value; auto typed like --var unless --type is given (--type Date accepts the date-time forms).',
        },
      ]
    : [];
  return [
    ...body.fields.map((field) => fieldOption(field, required.has(field.name))),
    ...variables,
    ...value,
    {
      flag: 'body',
      syntax: '--body <json|@file|->',
      kind: 'value',
      valueName: '<json|@file|->',
      type: 'json',
      required: false,
      source: 'body',
      description:
        'Request body as JSON, @path to a JSON file or - for stdin; flags above override its properties.',
    },
    {
      flag: 'validate',
      syntax: '--no-validate',
      kind: 'negated',
      type: 'boolean',
      required: false,
      source: 'validate',
      description: 'Skip the client side validation of the request body against the API schema.',
    },
  ];
}

function multipartOption(field: MultipartField): OptionDoc {
  const base = { flag: field.flag, required: false, description: summarize(field.description) };
  if (field.type === 'binary') {
    return {
      ...base,
      syntax: `--${field.flag} <path>`,
      kind: 'value',
      valueName: '<path>',
      type: 'file',
      source: 'file',
    };
  }
  if (field.type === 'boolean') {
    return booleanOption({ ...base, type: 'boolean', source: 'multipart' }, false);
  }
  return valueOption({ ...base, type: typeName('string', field.format), source: 'multipart' });
}

function multipartBodyOptions(body: MultipartBodySpec): OptionDoc[] {
  const baseDir: OptionDoc[] = body.resources
    ? [
        {
          flag: 'base-dir',
          syntax: '--base-dir <dir>',
          kind: 'value',
          valueName: '<dir>',
          type: 'string',
          required: false,
          source: 'base-dir',
          description:
            'Name resources by their path relative to this directory instead of their file name.',
        },
      ]
    : [];
  return [...body.fields.map(multipartOption), ...baseDir];
}

function paginationOptions(operation: OperationSpec): OptionDoc[] {
  if (!isPaginated(operation)) return [];
  return [
    {
      flag: 'all',
      syntax: '--all',
      kind: 'presence',
      type: 'boolean',
      required: false,
      source: 'all',
      description: `Fetch all pages and print one combined list (page size --max-results, default ${DEFAULT_PAGE_SIZE}).`,
    },
  ];
}

/** Every operation specific option in display order: query, body, multipart, pagination. */
export function operationOptions(operation: OperationSpec, schemas?: Schemas): OptionDoc[] {
  const body = operation.body;
  return [
    ...operation.params.filter((param) => param.in === 'query').map(queryOption),
    ...(body?.kind === 'json' ? jsonBodyOptions(body, schemas) : []),
    ...(body?.kind === 'multipart' ? multipartBodyOptions(body) : []),
    ...paginationOptions(operation),
  ];
}

/** Positional arguments: path parameters in path order, then resource files of a deployment. */
export function operationArguments(operation: OperationSpec): ArgumentDoc[] {
  const path = operation.params
    .filter((param) => param.in === 'path')
    .map((param): ArgumentDoc => ({
      name: argumentName(param.flag),
      required: true,
      variadic: false,
      description: summarize(param.description),
    }));
  const resources: ArgumentDoc[] =
    operation.body?.kind === 'multipart' && operation.body.resources
      ? [
          {
            name: 'files',
            required: true,
            variadic: true,
            description: 'Resource files to deploy (BPMN, DMN, forms, scripts, ...).',
          },
        ]
      : [];
  return [...path, ...resources];
}

/** `<name>` or `<name...>` of an argument in usage lines. */
export function argumentSyntax(argument: ArgumentDoc): string {
  return `<${argument.name}${argument.variadic ? '...' : ''}>`;
}

/** One line usage, e.g. `operate process-definition start <key> [options]`. */
export function usageLine(operation: OperationSpec): string {
  const args = operationArguments(operation).map(argumentSyntax);
  return ['operate', operation.group, operation.name, ...args, '[options]'].join(' ');
}
