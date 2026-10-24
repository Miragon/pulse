import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { escapeHtml, failurePage, successPage } from './pages.js';

describe('callback pages', () => {
  it('says the login arrived, without scripts, links or external resources', () => {
    const page = successPage();
    expect(page).toContain('<title>operate login</title>');
    expect(page).toContain(
      '<h1>Logged in</h1><p>operate received the login. You can close this tab and return to the terminal.</p>',
    );
    for (const page of [successPage(), failurePage('x')]) {
      expect(page).not.toMatch(/<script|<a |<link|<img|src=|href=/i);
      expect(page.startsWith('<!doctype html>')).toBe(true);
    }
  });

  it('shows the reason of a failure, HTML-escaped', () => {
    expect(failurePage('a <b> & "c" \'d\'')).toContain(
      '<h1>Login failed</h1><p>a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;</p><p>Return to the terminal for details.</p>',
    );
  });

  it('escapes every special character', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const escaped = escapeHtml(text);
        expect(escaped).not.toMatch(/[<>"']/);
        expect(escaped.replace(/&(?:amp|lt|gt|quot|#39);/g, '')).not.toContain('&');
      }),
    );
  });
});
