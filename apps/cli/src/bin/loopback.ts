/**
 * The loopback HTTP server of `operate auth login` (design §16.10, RFC 8252 §7.3): bound to
 * 127.0.0.1 only (never `localhost`, `0.0.0.0` or `::`), request bodies ignored, static HTML
 * answers with security headers. `close()` waits for answers in flight, then drops every
 * connection.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LoopbackRequest, LoopbackResponse, LoopbackServer } from '../runtime.js';

type Handler = (request: LoopbackRequest) => Promise<LoopbackResponse>;

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  Connection: 'close',
} as const;

const ERROR_PAGE =
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>operate login</title></head><body><h1>Login failed</h1><p>operate could not handle this request.</p></body></html>\n';

function toRequest(request: IncomingMessage): LoopbackRequest {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  return { method: request.method ?? 'GET', path: url.pathname, query: url.searchParams };
}

async function answer(handler: Handler, request: IncomingMessage, response: ServerResponse) {
  request.resume();
  let result: LoopbackResponse;
  try {
    result = await handler(toRequest(request));
  } catch {
    result = { status: 500, html: ERROR_PAGE };
  }
  await new Promise<void>((resolve) => {
    response.writeHead(result.status, HEADERS);
    response.end(result.html, () => {
      resolve();
    });
  });
}

export async function listenLoopback(port: number, handler: Handler): Promise<LoopbackServer> {
  const pending = new Set<Promise<void>>();
  const server = createServer((request, response) => {
    const done = answer(handler, request, response).finally(() => pending.delete(done));
    pending.add(done);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    async close() {
      await Promise.allSettled([...pending]);
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
