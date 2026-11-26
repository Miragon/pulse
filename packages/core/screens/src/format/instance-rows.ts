export class InstanceRows {
  static appended<Row extends { readonly id: string }>(
    shown: readonly Row[],
    more: readonly Row[],
  ): Row[] {
    const ids = new Set(shown.map((row) => row.id))
    return [...shown, ...more.filter((row) => !ids.has(row.id))]
  }
}
