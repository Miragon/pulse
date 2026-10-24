/** Path arguments and query parameters of an operation from the parsed command line. Pure. */

import { argumentName } from '../catalog/names.js';
import type { OperationSpec, ParamSpec } from '../catalog/types.js';
import { usageError } from '../errors.js';
import { type CommandValues, scalarFlag } from './command-values.js';
import { convertScalar } from './values.js';

export interface SplitArgs {
  /** Values of the path parameters, in path order. */
  readonly pathArgs: string[];
  /** Remaining positional arguments: resource files of `deployment create`. */
  readonly files: string[];
}

function acceptsFiles(operation: OperationSpec): boolean {
  return operation.body?.kind === 'multipart' && operation.body.resources;
}

/** Path params are strings; some have an enum (`metrics get <metrics-name>`). */
function checkPathArg(param: ParamSpec, value: string): string {
  return String(convertScalar(param, value, `<${argumentName(param.flag)}>`));
}

function usageHint(operation: OperationSpec): string {
  return `Run "operate ${operation.group} ${operation.name} --help" for the usage.`;
}

function missingArguments(operation: OperationSpec, missing: readonly ParamSpec[]) {
  const names = missing.map((param) => `<${argumentName(param.flag)}>`).join(' ');
  return usageError(`Missing argument(s): ${names}`, usageHint(operation));
}

/** Splits positionals into path arguments and resource files; validates count and enums. */
export function splitArgs(operation: OperationSpec, args: readonly string[]): SplitArgs {
  const pathParams = operation.params.filter((param) => param.in === 'path');
  const pathArgs = pathParams.map((param, index) => {
    const value = args[index];
    if (value === undefined) throw missingArguments(operation, pathParams.slice(index));
    return checkPathArg(param, value);
  });
  const files = args.slice(pathParams.length);
  if (files.length > 0 && !acceptsFiles(operation)) {
    throw usageError(`Unexpected argument(s): ${files.join(' ')}`, usageHint(operation));
  }
  return { pathArgs, files };
}

/** Query values keyed by wire name, typed and validated per the catalog. */
export function buildQuery(
  operation: OperationSpec,
  flags: CommandValues['flags'],
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const param of operation.params) {
    if (param.in !== 'query') continue;
    const value = flags[param.flag];
    if (value !== undefined) {
      query[param.name] = String(scalarFlag(param, value, `--${param.flag}`));
    } else if (param.required) {
      throw usageError(`Missing required option --${param.flag}`, usageHint(operation));
    }
  }
  return query;
}
