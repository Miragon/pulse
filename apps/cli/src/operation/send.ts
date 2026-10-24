/**
 * Sends a prepared request and decodes the response; HTTP error statuses become OperateErrors
 * whose hints name `ref`, the command that sent the request, when given, the user whose Basic
 * auth credentials were sent, or the auth provider's own hint for a rejected token (OAuth).
 */

import { type ClientOptions, send } from '../http/client.js';
import { type CommandRef, httpError, redirectError } from '../http/errors.js';
import type { HttpRequest } from '../http/types.js';
import { decodeResponse } from './decode.js';
import { previewRequest } from './preview.js';
import type { OperationResult } from './result.js';

export async function sendRequest(
  request: HttpRequest,
  client: ClientOptions,
  ref?: CommandRef,
): Promise<OperationResult> {
  const response = await send(request, client);
  const { auth } = client;
  if (response.status >= 400) {
    const { principal, off } = auth;
    const rejectedHint =
      response.status === 401 || response.status === 403
        ? auth.rejectedHint?.(response.status)
        : undefined;
    const failed = { ...request, principal, authOff: off, rejectedHint, authNote: auth.note };
    throw httpError(response, failed, ref);
  }
  if (response.status >= 300) {
    throw redirectError(response, { ...request, loginStatusCommand: auth.loginStatusCommand });
  }
  return decodeResponse(response, previewRequest(request));
}
