/**
 * Builds CLI argument lists from the generated catalog instead of hard-coded flag names, so the
 * integration tests break loudly when a command or flag is renamed.
 *
 * Options are keyed by the wire name of the catalog entry (`businessKey`, `variables`, `maxResults`,
 * `deployment-name`) or by the name of a special/global flag (`body`, `value`, `all`, `dry-run`,
 * `yes`, `read-only`, `out-file`, ...).
 */

import {
  GLOBAL_FLAGS,
  JSON_BODY_FLAGS,
  PAGINATION_FLAGS,
  RESOURCE_FLAGS,
  VARIABLE_VALUE_FLAGS,
} from '../../../scripts/catalog/flags.js';
import { findOperation, loadCatalog } from '../../../src/catalog/catalog.js';
import type { OperationSpec } from '../../../src/catalog/types.js';

/** `true` → `--flag`, `false` → `--no-flag`, arrays → the flag repeated once per entry. */
type OptionValue = string | number | boolean | readonly string[];
export type Options = Readonly<Record<string, OptionValue>>;

const catalog = loadCatalog();

/** The catalog operation of `"<group> <command>"`, e.g. `"process-definition start"`. */
function operation(command: string): OperationSpec {
  const [group = '', name = '', ...rest] = command.split(' ');
  const found = rest.length === 0 ? findOperation(catalog, group, name) : undefined;
  if (found === undefined) throw new Error(`The catalog has no command "operate ${command}"`);
  return found;
}

function catalogFlag(spec: OperationSpec, key: string): string | undefined {
  const param = spec.params.find((entry) => entry.in === 'query' && entry.name === key);
  if (param !== undefined) return param.flag;
  const body = spec.body;
  if (body === undefined) return undefined;
  const field = body.fields.find((entry) => entry.name === key);
  if (field !== undefined) return field.flag;
  if (body.kind === 'json') return body.variableMaps.find((entry) => entry.name === key)?.flag;
  return undefined;
}

/** Operation specific flags that are not catalog entries (see scripts/catalog/flags.ts). */
function specialFlags(spec: OperationSpec): readonly string[] {
  const body = spec.body;
  const paginated = spec.params.some((param) => param.name === 'maxResults');
  return [
    ...(paginated ? PAGINATION_FLAGS : []),
    ...(body?.kind === 'json' ? JSON_BODY_FLAGS : []),
    ...(body?.kind === 'json' && body.variableValue ? VARIABLE_VALUE_FLAGS : []),
    ...(body?.kind === 'multipart' && body.resources ? RESOURCE_FLAGS : []),
  ];
}

/** `--<flag>` for a global option (`--url`, `--yes`, `--dry-run`, ...). */
export function globalFlag(name: string): string {
  if (!GLOBAL_FLAGS.includes(name)) throw new Error(`"${name}" is not a global flag`);
  return `--${name}`;
}

/** `--<flag>` of an option of the given command; fails when the command has no such option. */
function flag(command: string, key: string): string {
  const spec = operation(command);
  const name =
    catalogFlag(spec, key) ??
    [...specialFlags(spec), ...GLOBAL_FLAGS].find((candidate) => candidate === key);
  if (name === undefined) throw new Error(`"operate ${command}" has no option for "${key}"`);
  return `--${name}`;
}

function optionArgs(command: string, key: string, value: OptionValue): string[] {
  const name = flag(command, key);
  if (value === true) return [name];
  if (value === false) return [`--no-${name.slice(2)}`];
  if (typeof value === 'string' || typeof value === 'number') return [name, String(value)];
  return value.flatMap((entry) => [name, entry]);
}

/**
 * Argument list `<group> <command> [positionals...] [options...]`. Positionals are the path
 * parameters in path order (then resource files for `deployment create`).
 */
export function argv(command: string, positionals: readonly string[] = [], options: Options = {}) {
  const spec = operation(command);
  const pathParams = spec.params.filter((param) => param.in === 'path').length;
  if (positionals.length < pathParams) {
    throw new Error(`"operate ${command}" needs ${pathParams} positional argument(s)`);
  }
  return [
    spec.group,
    spec.name,
    ...positionals,
    ...Object.entries(options).flatMap(([key, value]) => optionArgs(command, key, value)),
  ];
}
