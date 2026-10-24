/** The catalog and the describe view of one command, for the describe tests (src/docs/describe*). */

import { findOperation, loadCatalog } from "../../src/catalog/catalog.js"
import { type DescribeView, describeOperation } from "../../src/docs/describe.js"

export const catalog = loadCatalog()

export function view(group: string, name: string): DescribeView {
  const operation = findOperation(catalog, group, name)
  if (operation === undefined) throw new Error(`unknown command ${group} ${name}`)
  return describeOperation(operation, catalog)
}
