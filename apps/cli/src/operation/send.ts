/**
 * Sends a prepared request and decodes the response; HTTP error statuses become PulseCliErrors
 * whose hints name `ref`, the command that sent the request, when given, the user whose Basic
 * auth credentials were sent, or the auth provider's own hint for a rejected token (OAuth). A
 * redirect, the deadline and the network fail in `send` already.
 */

import { type Client, send } from "../http/client.js"
import { type CommandRef, httpError } from "../http/errors.js"
import type { HttpRequest } from "../http/types.js"
import { decodeResponse } from "./decode.js"
import { previewRequest } from "./preview.js"
import type { OperationResult } from "./result.js"

export async function sendRequest(
  request: HttpRequest,
  client: Client,
  ref?: CommandRef,
): Promise<OperationResult> {
  const response = await send(request, client)
  if (response.status >= 400) {
    const { auth } = client
    const { principal, off } = auth
    const rejectedHint =
      response.status === 401 || response.status === 403
        ? auth.rejectedHint?.(response.status)
        : undefined
    const failed = { ...request, principal, authOff: off, rejectedHint, authNote: auth.note }
    throw httpError(response, failed, ref)
  }
  return decodeResponse(response, previewRequest(request))
}
