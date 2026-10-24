/**
 * `operate api <METHOD> <path>` (design §5): a raw request relative to the REST API root with the
 * same guards, output and errors as the generated commands. The path is normalized first
 * (src/operation/raw-request.ts); the effect comes from the catalog operation with the same method
 * and path template, else from the method.
 */

import type { Command } from 'commander';
import { findOperationByPath } from '../../catalog/catalog.js';
import type { Effect, OperationSpec } from '../../catalog/types.js';
import { usageError } from '../../errors.js';
import type { HttpRequest } from '../../http/types.js';
import { readBody } from '../../operation/body.js';
import { commandRef } from '../../operation/command-ref.js';
import { checkEffect, dryRunPreview, sendRequest } from '../../operation/execute.js';
import { apiPath, apiQuery, type ApiPath, parseApiPath } from '../../operation/raw-request.js';
import { acceptHeader, joinUrl } from '../../operation/request.js';
import type { OperationResult } from '../../operation/result.js';
import { mergeHeaders, stringifyJson } from '../../util.js';
import { subcommand } from '../command.js';
import type { CliContext } from '../context.js';
import { emitResult } from '../emit.js';
import { addGlobalOptions, readGlobals } from '../globals.js';
import { collect } from '../options.js';
import { clientOf, guardsOf, openSession, type Session } from '../session.js';
import type { UtilityCommand } from './types.js';

const METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

const DESCRIPTION = [
  'Send a raw request to a path relative to the REST API root.',
  '',
  'Adds /engine/<name> when --engine is set and the path does not start with /engine. Dot segments, repeated and trailing slashes are normalized before the request is matched and sent. The effect (for --read-only and --yes) is the one of the catalog operation with the same method and path; other GET, HEAD and OPTIONS requests are reads, DELETE requests deletes, everything else writes.',
].join('\n');

export function parseMethod(raw: string): string {
  const method = raw.toUpperCase();
  if (!METHODS.includes(method)) {
    throw usageError(`Unsupported HTTP method "${raw}"`, `Use one of: ${METHODS.join(', ')}.`);
  }
  return method;
}

export function apiEffect(operation: OperationSpec | undefined, method: string): Effect {
  if (operation !== undefined) return operation.effect;
  if (READ_METHODS.has(method)) return 'read';
  return method === 'DELETE' ? 'delete' : 'write';
}

interface ApiCall extends ApiPath {
  readonly method: string;
  readonly operation: OperationSpec | undefined;
}

interface ApiOptions {
  readonly query?: string[];
  readonly body?: string;
}

async function apiRequest(
  call: ApiCall,
  options: ApiOptions,
  session: Session,
  context: CliContext,
): Promise<HttpRequest> {
  const { runtime } = context;
  const deps = { fs: runtime.fs, readStdin: () => runtime.readStdin() };
  const body =
    options.body === undefined ? undefined : stringifyJson(await readBody(options.body, deps));
  const path = apiPath(call.path, session.config.engine, call.operation?.engineScoped ?? true);
  const location = `${path}${apiQuery(call.query, options.query ?? [])}`;
  const defaults = {
    Accept: call.operation === undefined ? 'application/json' : acceptHeader(call.operation),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  };
  return {
    method: call.method,
    url: joinUrl(session.config.url, location),
    headers: mergeHeaders(defaults, session.config.headers),
    ...(body === undefined ? {} : { body }),
  };
}

async function runApi(rawMethod: string, rawPath: string, command: Command, context: CliContext) {
  const { runtime, catalog } = context;
  const options = command.opts<ApiOptions>();
  const session = await openSession(context, readGlobals(command), {
    bodyFromStdin: options.body === '-',
  });
  const method = parseMethod(rawMethod);
  const { path, query } = parseApiPath(rawPath);
  const operation = findOperationByPath(catalog, method, path);
  checkEffect(apiEffect(operation, method), `operate api ${method} ${path}`, guardsOf(session));
  const request = await apiRequest({ method, path, query, operation }, options, session, context);
  const client = clientOf(session, runtime);
  const result: OperationResult = session.globals.dryRun
    ? await dryRunPreview(request, client.auth)
    : await sendRequest(
        request,
        client,
        operation === undefined ? undefined : commandRef(operation, catalog),
      );
  await emitResult(result, session, runtime);
}

export const apiCommand: UtilityCommand = {
  name: 'api',
  nested: false,
  register(program, context) {
    const command = subcommand(program, 'api')
      .summary('Send a raw request to the REST API')
      .description(DESCRIPTION)
      .usage('<method> <path> [options]')
      .argument('<method>', `HTTP method: ${METHODS.join(', ')}`)
      .argument('<path>', 'Path relative to the REST API root, e.g. /process-definition/count')
      .option('--query <key=value>', 'Query parameter; repeatable', collect)
      .option('--body <json|@file|->', 'Request body as JSON, @path to a JSON file or - for stdin');
    addGlobalOptions(command);
    command.action((method: string, path: string) => runApi(method, path, command, context));
  },
};
