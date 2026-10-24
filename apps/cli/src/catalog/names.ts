/** Display names derived from catalog names at runtime. Pure. */

/** Name of a positional argument: `varName` → `var-name`; kebab names stay unchanged. */
export function argumentName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
