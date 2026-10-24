/** Shell quoting for the ready-to-run command lines of the workflow views. Pure. */

const PLAIN = /^[\w.:@/+=-]+$/;

/** The value as one shell word: as is when it needs no quoting, else single-quoted. */
export function shellWord(value: string): string {
  return PLAIN.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
