/** URLs as error messages may show them. Pure. */

/**
 * A rejected URL as error messages may show it: without query and fragment (tokens such as
 * `?access_token=`) and with everything before an `@` hidden, with or without `//` (a forgotten
 * scheme makes `user:password@host` parse as scheme `user:`).
 */
export function redactUrl(url: string): string {
  const [base = ''] = url.split(/[?#]/, 1);
  const suffix = base.length < url.length ? '?…' : '';
  const at = base.lastIndexOf('@');
  if (at < 0) return `${base}${suffix}`;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(base)?.[0] ?? '';
  return `${scheme}***${base.slice(at)}${suffix}`;
}
