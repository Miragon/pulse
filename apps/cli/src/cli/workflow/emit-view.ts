/**
 * Prints a workflow view (design §17.2.3): JSON per §2.6 (projected with `--fields`, with the
 * warnings for fields that match nothing), the section text of the view on `-o table`, or the
 * JSON view written to `--out-file` with the §2.6 summary.
 */

import { fieldWarnings, renderValue } from '../../output/render.js';
import type { Runtime } from '../../runtime.js';
import { writeOutFile, writeText } from '../emit.js';
import { renderOptionsOf, type Session } from '../session.js';

export async function emitView(
  value: unknown,
  text: (maxWidth: number) => string,
  session: Session,
  runtime: Runtime,
): Promise<void> {
  const options = renderOptionsOf(session, runtime);
  const warnings = fieldWarnings(value, options.fields);
  const outFile = session.globals.outFile;
  if (outFile !== undefined) {
    const data = renderValue(value, { ...options, format: 'json' });
    const body = { data, contentType: 'application/json' };
    await writeOutFile({ body, path: outFile, warnings }, options, runtime);
    return;
  }
  if (options.format === 'json' || options.fields !== undefined) {
    writeText(runtime.stdout, renderValue(value, options));
    writeText(runtime.stderr, warnings);
    return;
  }
  writeText(runtime.stdout, text(options.maxWidth));
}
