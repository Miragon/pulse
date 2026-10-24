/**
 * Standard reason phrases (as in Node's `http.STATUS_CODES`). Tomcat, which serves the REST API of
 * Operaton, CIB seven and Camunda 7 Run, sends status lines without a reason phrase, so `fetch`
 * reports an empty `statusText`; the client fills in the standard phrase instead.
 */

const REASON_PHRASES: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** The status text the server sent, else the standard reason phrase, else `''`. */
export function statusTextOf(status: number, sent: string): string {
  return sent === '' ? (REASON_PHRASES[status] ?? '') : sent;
}
