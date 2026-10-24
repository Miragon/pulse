/** Version of the package, read from package.json at build time (the bundle inlines it). */

import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
