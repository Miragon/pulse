/** Request previews for `--dry-run` and results: JSON bodies parsed, multipart parts summarized. */

import type { AuthProvider } from '../auth/types.js';
import type { HttpRequest } from '../http/types.js';
import { mergeHeaders, parseJson } from '../util.js';
import type { MultipartPartPreview, OperationResult, RequestPreview } from './result.js';

/** The JSON body as value (large integers kept), or the text when it is not JSON. */
function bodyValue(text: string): unknown {
  try {
    return parseJson(text);
  } catch {
    return text;
  }
}

function partsOf(form: FormData): MultipartPartPreview[] {
  return [...form.entries()].map(([name, value]) =>
    typeof value === 'string' ? { name, value } : { name, fileName: value.name, bytes: value.size },
  );
}

export function previewRequest(request: HttpRequest): RequestPreview {
  const preview = { method: request.method, url: request.url, headers: { ...request.headers } };
  if (request.body === undefined) return preview;
  const body = typeof request.body === 'string' ? bodyValue(request.body) : partsOf(request.body);
  return { ...preview, body };
}

/**
 * The `--dry-run` result: the request with the auth headers the provider knows without network
 * access, refresh or lock (Basic, a cached OAuth token), plus the provider's note (e.g. "not
 * logged in"). The output layer masks the headers unless --show-secrets.
 */
export async function dryRunPreview(
  request: HttpRequest,
  auth: AuthProvider,
): Promise<Extract<OperationResult, { kind: 'dry-run' }>> {
  const preview = (await auth.preview?.()) ?? { headers: {} };
  const merged = { ...request, headers: mergeHeaders(request.headers, preview.headers) };
  const result = { kind: 'dry-run', request: previewRequest(merged) } as const;
  return preview.note === undefined ? result : { ...result, note: preview.note };
}
