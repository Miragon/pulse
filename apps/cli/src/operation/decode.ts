/**
 * Decodes an HTTP response into an `OperationResult` by status and content type:
 * 204 or empty body → none; JSON → parsed without losing large integers (text if it does not
 * parse); text, XML, CSV and JavaScript → text; everything else → binary.
 */

import type { HttpResponse } from '../http/types.js';
import { parseJson } from '../util.js';
import type { OperationResult, RequestPreview } from './result.js';

/**
 * XML, CSV and JavaScript as the (suffix of the) subtype: `application/xml`, `image/svg+xml`,
 * `application/x-javascript`. Not `...openxmlformats-officedocument...` (Office files are binary).
 */
const TEXT_SUBTYPE = /[/+-](?:xml|csv|javascript)$/;

const CHARSET = /;\s*charset="?([^";]+)/i;

/** The media type without parameters, in lower case: `Text/XML; charset=UTF-8` → `text/xml`. */
function essence(contentType: string): string {
  return contentType.replace(/;.*/s, '').trim().toLowerCase();
}

function isText(type: string): boolean {
  return type.startsWith('text/') || TEXT_SUBTYPE.test(type);
}

/** Decodes with the charset of the content type; UTF-8 when it is absent or unknown. */
function decodeText(body: Uint8Array, contentType: string): string {
  const label = CHARSET.exec(contentType)?.[1];
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder().decode(body);
  }
}

export function decodeResponse(response: HttpResponse, request: RequestPreview): OperationResult {
  const { status, contentType, body } = response;
  if (status === 204 || body.length === 0) {
    return { kind: 'none', status, statusText: response.statusText, request };
  }
  const type = essence(contentType);
  if (type.includes('json')) {
    const text = decodeText(body, contentType);
    try {
      return { kind: 'json', status, value: parseJson(text), text, request };
    } catch {
      return { kind: 'text', status, text, contentType, request };
    }
  }
  if (isText(type)) {
    return { kind: 'text', status, text: decodeText(body, contentType), contentType, request };
  }
  return { kind: 'binary', status, data: body, contentType, request };
}
