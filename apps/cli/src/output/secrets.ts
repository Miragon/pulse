/**
 * Secret masking for headers and URLs, and the curl rendering of request previews. Pure functions:
 * the CLI decides whether to mask (`--show-secrets` turns masking off).
 */

import type { MultipartPartPreview, RequestPreview } from '../operation/result.js';
import { isRecord, isSecretHeader, stringifyJson } from '../util.js';

/** What a masked secret shows instead of its value. */
export const MASK = '***';

/** Well-known auth schemes that stay visible in front of a masked credential. */
const AUTH_SCHEME =
  /^(Basic|Bearer|Digest|DPoP|HOBA|Mutual|Negotiate|NTLM|Token|AWS4-HMAC-SHA256)\s+\S/i;

/**
 * `scheme://user:` (group 1), then a non-empty password up to `@`. The authority ends at `/`, `?`,
 * `#` or `\`; the greedy password makes the userinfo end at its last `@`, like URL parsers do.
 */
const URL_PASSWORD = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^:/?#\\]*:)[^/?#\\]+@/;

/**
 * URL_PASSWORD for URLs anywhere in free text (error messages, stacks), where a URL also ends at
 * whitespace, double quotes and angle brackets. The scheme length is bounded (real schemes are
 * short) so that long words do not make the scan quadratic.
 */
const TEXT_URL_PASSWORD = /([A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s"<>:/?#\\]*:)[^\s"<>/?#\\]+@/g;

/** Method names that need no shell quoting. */
const PLAIN_WORD = /^[A-Za-z0-9_-]+$/;

/** Header values that fetch sends as empty, after trimming HTTP whitespace. */
const BLANK = /^[\t\n\r ]*$/;

/**
 * curl `-F` text values that curl would interpret: file references (`@`, `<`), quoted strings
 * (`"`), `;type=` style options, and blanks at either end, which curl strips (its ISSPACE set).
 */
const FORM_SPECIAL = /^[@<"\t-\r ]|;|[\t-\r ]$/;

/** `-F name=@file` file names that must be double-quoted: separators, quotes and outer blanks. */
const FORM_FILE_SPECIAL = /[;,"\\]|^[\t-\r ]|[\t-\r ]$/;

/** `Bearer abc` → `Bearer ***`; values without a known auth scheme → `***`. */
function maskSecret(value: string): string {
  const scheme = AUTH_SCHEME.exec(value)?.[1];
  return scheme === undefined ? MASK : `${scheme} ${MASK}`;
}

/** Masks the values of secret headers (authorization, cookies, tokens, passwords, API keys). */
export function maskHeaders(
  headers: Readonly<Record<string, string>>,
  show: boolean,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      show || !isSecretHeader(name) ? value : maskSecret(value),
    ]),
  );
}

/** Masks the password of a URL's userinfo: `https://user:pw@host/x` → `https://user:***@host/x`. */
export function maskUrl(url: string, show: boolean): string {
  return show ? url : url.replace(URL_PASSWORD, `$1${MASK}@`);
}

/**
 * Masks userinfo passwords of all URLs in free text, such as error messages and stacks: network
 * errors embed the request URL, and fetch rejects URLs with credentials by quoting them.
 */
export function maskUrlsInText(text: string, show: boolean): string {
  return show ? text : text.replace(TEXT_URL_PASSWORD, `$1${MASK}@`);
}

/** POSIX shell single quoting: `it's` → `'it'\''s'`. */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function shellWord(text: string): string {
  return PLAIN_WORD.test(text) ? text : shellQuote(text);
}

function isJsonContentType(headers: Readonly<Record<string, string>>): boolean {
  return Object.entries(headers).some(
    ([name, value]) =>
      name.toLowerCase() === 'content-type' && value.toLowerCase().includes('json'),
  );
}

function isFilePart(part: Record<string, unknown>): boolean {
  return typeof part.fileName === 'string' && typeof part.bytes === 'number';
}

function isPart(value: unknown): value is MultipartPartPreview {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (typeof value.value === 'string' || isFilePart(value))
  );
}

/** The parts of a multipart preview, or undefined when the body is JSON. */
function multipartParts(request: RequestPreview): readonly MultipartPartPreview[] | undefined {
  const { body } = request;
  if (!Array.isArray(body) || body.length === 0 || isJsonContentType(request.headers)) {
    return undefined;
  }
  return body.every(isPart) ? body : undefined;
}

function formFile(fileName: string): string {
  return FORM_FILE_SPECIAL.test(fileName) ? `"${fileName.replace(/["\\]/g, '\\$&')}"` : fileName;
}

/** `@file`, plus `;filename=` for paths: curl itself sends only the base name. */
function fileContent(fileName: string): string {
  const file = formFile(fileName);
  return fileName.includes('/') ? `@${file};filename=${file}` : `@${file}`;
}

function formArgs(part: MultipartPartPreview): string[] {
  if ('fileName' in part) return ['-F', shellQuote(`${part.name}=${fileContent(part.fileName)}`)];
  const option = FORM_SPECIAL.test(part.value) ? '--form-string' : '-F';
  return [option, shellQuote(`${part.name}=${part.value}`)];
}

function bodyArgs(request: RequestPreview): string[] {
  if (request.body === undefined) return [];
  const parts = multipartParts(request);
  if (parts !== undefined) return parts.flatMap(formArgs);
  return ['--data-raw', shellQuote(stringifyJson(request.body) ?? '')];
}

/** GET is curl's default; `-X HEAD` would make curl wait for a body, `--head` does not. */
function methodArgs(method: string): string[] {
  if (method === 'GET') return [];
  return method === 'HEAD' ? ['--head'] : ['-X', shellWord(method)];
}

/**
 * Renders a request preview as a single curl command line. Headers are used as given, so callers
 * mask them first.
 */
export function curlCommand(request: RequestPreview): string {
  const method = methodArgs(request.method);
  // curl drops a header with a blank value unless it is written as `Name;`
  const headers = Object.entries(request.headers).flatMap(([name, value]) => [
    '-H',
    shellQuote(BLANK.test(value) ? `${name};` : `${name}: ${value}`),
  ]);
  return ['curl', ...method, shellQuote(request.url), ...headers, ...bodyArgs(request)].join(' ');
}
