import { describe, expect, it, vi } from 'vitest';
import { basicAuth } from '../auth/basic.js';
import { noAuth } from '../auth/none.js';
import { dryRunPreview, previewRequest } from './preview.js';

describe('previewRequest', () => {
  it('copies method, url and headers without a body', () => {
    const headers = { Accept: 'application/json' };
    const preview = previewRequest({ method: 'GET', url: 'http://h/x', headers });
    expect(preview).toEqual({ method: 'GET', url: 'http://h/x', headers });
    expect(preview).not.toHaveProperty('body');
    expect(preview.headers).not.toBe(headers);
  });

  it('parses JSON bodies', () => {
    expect(
      previewRequest({ method: 'POST', url: 'u', headers: {}, body: '{"a":[1,{"b":null}]}' }).body,
    ).toEqual({ a: [1, { b: null }] });
  });

  it('keeps bodies that are not JSON as text', () => {
    expect(previewRequest({ method: 'POST', url: 'u', headers: {}, body: 'plain' }).body).toBe(
      'plain',
    );
    expect(previewRequest({ method: 'POST', url: 'u', headers: {}, body: '' }).body).toBe('');
  });

  it('summarizes multipart parts', () => {
    const form = new FormData();
    form.append('deployment-name', 'app');
    form.append('order.bpmn', new Blob(['<bpmn/>']), 'order.bpmn');
    form.append('enable-duplicate-filtering', 'true');
    expect(previewRequest({ method: 'POST', url: 'u', headers: {}, body: form }).body).toEqual([
      { name: 'deployment-name', value: 'app' },
      { name: 'order.bpmn', fileName: 'order.bpmn', bytes: 7 },
      { name: 'enable-duplicate-filtering', value: 'true' },
    ]);
  });

  it('previews an empty form as no parts', () => {
    expect(
      previewRequest({ method: 'POST', url: 'u', headers: {}, body: new FormData() }).body,
    ).toEqual([]);
  });
});

describe('dryRunPreview', () => {
  const request = { method: 'GET', url: 'http://h/x', headers: { Accept: 'application/json' } };

  it('adds the headers a provider knows without network access', async () => {
    const basic = basicAuth({
      type: 'basic',
      username: 'demo',
      password: 'demo',
      sources: { username: 'flag', password: 'flag' },
    });
    await expect(dryRunPreview(request, basic)).resolves.toEqual({
      kind: 'dry-run',
      request: {
        ...request,
        headers: { Accept: 'application/json', Authorization: 'Basic ZGVtbzpkZW1v' },
      },
    });
    expect(request.headers).toEqual({ Accept: 'application/json' });
  });

  it('adds nothing for providers without a preview, and never calls headers()', async () => {
    await expect(dryRunPreview(request, noAuth())).resolves.toEqual({ kind: 'dry-run', request });
    const headers = vi.fn(() => Promise.resolve({ Authorization: 'Bearer t' }));
    await expect(dryRunPreview(request, { type: 'x', headers })).resolves.toEqual({
      kind: 'dry-run',
      request,
    });
    expect(headers).not.toHaveBeenCalled();
  });

  it('passes the note of the provider on', async () => {
    const provider = {
      type: 'oauth',
      headers: () => Promise.reject(new Error('no network in a dry run')),
      preview: () => Promise.resolve({ headers: {}, note: 'Not logged in' }),
    };
    await expect(dryRunPreview(request, provider)).resolves.toEqual({
      kind: 'dry-run',
      request,
      note: 'Not logged in',
    });
  });
});
