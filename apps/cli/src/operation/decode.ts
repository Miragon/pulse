/**
 * Decodes an HTTP response into an `OperationResult` by status and content type:
 * 204 or empty body → none; JSON → parsed without losing large integers (text if it does not
 * parse); text, XML, CSV and JavaScript → text; everything else → binary. The text in the charset
 * its Content-Type names, and the JSON reading, are @miragon/pulse-http's.
 */

import { decodeText, mediaTypeOf, parseJson } from "@miragon/pulse-http"
import type { HttpResponse } from "../http/types.js"
import type { OperationResult, RequestPreview } from "./result.js"

/**
 * XML, CSV and JavaScript as the (suffix of the) subtype: `application/xml`, `image/svg+xml`,
 * `application/x-javascript`. Not `...openxmlformats-officedocument...` (Office files are binary).
 */
const TEXT_SUBTYPE = /[/+-](?:xml|csv|javascript)$/

function isText(type: string): boolean {
  return type.startsWith("text/") || TEXT_SUBTYPE.test(type)
}

export function decodeResponse(response: HttpResponse, request: RequestPreview): OperationResult {
  const { status, contentType, body } = response
  if (status === 204 || body.length === 0) {
    return { kind: "none", status, statusText: response.statusText, request }
  }
  const type = mediaTypeOf(contentType)
  if (type.includes("json")) {
    const text = decodeText(response)
    try {
      return { kind: "json", status, value: parseJson(text, "bigint"), text, request }
    } catch {
      return { kind: "text", status, text, contentType, request }
    }
  }
  if (isText(type)) {
    return { kind: "text", status, text: decodeText(response), contentType, request }
  }
  return { kind: "binary", status, data: body, contentType, request }
}
