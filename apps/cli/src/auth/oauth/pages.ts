/**
 * The HTML pages of the login callback (design §16.4.1): static, without scripts, links or
 * external resources, so the authorization code in the URL never leaks through a Referer. A
 * failure page shows a fixed reason (HTML-escaped), never a token, code or received parameter
 * except a validated error code.
 */

const STYLE = 'body{font-family:system-ui,sans-serif;margin:3rem;max-width:40rem}';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function page(body: string): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>operate login</title><style>${STYLE}</style></head><body>${body}</body></html>\n`;
}

export function successPage(): string {
  return page(
    '<h1>Logged in</h1><p>operate received the login. You can close this tab and return to the terminal.</p>',
  );
}

export function failurePage(reason: string): string {
  return page(
    `<h1>Login failed</h1><p>${escapeHtml(reason)}</p><p>Return to the terminal for details.</p>`,
  );
}
