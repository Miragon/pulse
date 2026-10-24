export class TableKeys {
  static wantsSide(event: KeyboardEvent | MouseEvent): boolean {
    return event.metaKey || event.ctrlKey;
  }

  static isCopy(event: KeyboardEvent): boolean {
    return TableKeys.wantsSide(event) && event.key.toLowerCase() === 'c';
  }

  static focusRow(row: EventTarget | null, index: number): void {
    const body = row instanceof HTMLElement ? row.parentElement : null;
    body?.querySelectorAll<HTMLElement>('tr')[index]?.focus();
  }
}
