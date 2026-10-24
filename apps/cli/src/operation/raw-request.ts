/**
 * Path, query and engine prefix of raw requests (`operate api <METHOD> <path>`). The path is
 * normalized before it is matched against the catalog and before it is sent, so that the guards
 * judge exactly the request that goes out: `/process-instance/./delete`, `/x/../process-instance/
 * delete`, `/process-instance//delete/` and `%2e` segments all become `/process-instance/delete`,
 * a bulk operation that needs `--yes`. Pure.
 */

import { usageError } from '../errors.js';

/** Base for resolving dot segments; never contacted. */
const PLACEHOLDER_ORIGIN = 'http://operate.invalid';

const PATH_HINT = 'Example: operate api GET /process-definition/count; set the root with --url.';

export interface ApiPath {
  /** Normalized path with a leading slash and no trailing slash (`/` for the root). */
  readonly path: string;
  /** The query string of the argument, without `?`. */
  readonly query: string;
}

/**
 * Splits and normalizes the path argument: dot segments (also percent-encoded ones) are resolved
 * like the server would, repeated slashes collapse, trailing slashes go. Absolute URLs, fragments
 * (`#`) and matrix parameters (`;`), which the server would strip before matching, are refused.
 */
export function parseApiPath(raw: string): ApiPath {
  if (raw.includes('://')) {
    throw usageError(`Expected a path relative to the REST API root, got "${raw}"`, PATH_HINT);
  }
  if (/[#;]/.test(raw)) {
    throw usageError(
      `The path must not contain "#" or ";", got "${raw}"`,
      'Pass query parameters after "?" or with --query key=value.',
    );
  }
  const index = raw.indexOf('?');
  const rawPath = index < 0 ? raw : raw.slice(0, index);
  const collapsed = `/${rawPath}`.replace(/[/\\]+/g, '/');
  const resolved = new URL(collapsed, PLACEHOLDER_ORIGIN).pathname.replace(/\/+$/, '');
  return { path: resolved === '' ? '/' : resolved, query: index < 0 ? '' : raw.slice(index + 1) };
}

/** `?existing&k=v...` from the query of the path and the `--query k=v` options. */
export function apiQuery(existing: string, pairs: readonly string[]): string {
  const search = new URLSearchParams();
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    if (separator < 1) {
      throw usageError(
        `Invalid --query "${pair}": expected key=value`,
        'Example: --query maxResults=10',
      );
    }
    search.append(pair.slice(0, separator), pair.slice(separator + 1));
  }
  const parts = [existing, search.toString()].filter((part) => part !== '');
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/** True for paths that already name an engine (`/engine`, `/engine/{name}/...`). */
function namesEngine(path: string): boolean {
  return path === '/engine' || path.startsWith('/engine/');
}

/**
 * The path with the `/engine/{name}` prefix when an engine is set and the endpoint is engine
 * scoped (`engineScoped` of the matching catalog operation; unknown paths count as scoped).
 */
export function apiPath(path: string, engine: string | undefined, engineScoped: boolean): string {
  if (engine === undefined || engine === '' || !engineScoped || namesEngine(path)) return path;
  return `/engine/${encodeURIComponent(engine)}${path}`;
}
