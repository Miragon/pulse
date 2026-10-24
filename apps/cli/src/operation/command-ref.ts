/** The CLI command of a catalog operation, named in the hints of HTTP errors. */

import { findOperation } from '../catalog/catalog.js';
import type { Catalog, OperationSpec } from '../catalog/types.js';
import type { CommandRef } from '../http/errors.js';

/** `<group> <command>` of the operation and the `list` command of its group, if there is one. */
export function commandRef(operation: OperationSpec, catalog: Catalog): CommandRef {
  const list = findOperation(catalog, operation.group, 'list');
  return {
    command: `${operation.group} ${operation.name}`,
    ...(list === undefined ? {} : { listCommand: `${list.group} ${list.name}` }),
  };
}
