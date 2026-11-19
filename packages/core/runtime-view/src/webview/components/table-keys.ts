export class TableKeys {
  static isCopy(event: {
    readonly ctrlKey: boolean
    readonly metaKey: boolean
    readonly key: string
  }): boolean {
    return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c"
  }

  static indexOf(row: HTMLTableRowElement): number {
    return row.parentElement === null
      ? -1
      : [...row.parentElement.children].filter((child) => child.tagName === "TR").indexOf(row)
  }
}
