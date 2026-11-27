type Present<Fields> = { [Key in keyof Fields]?: Exclude<Fields[Key], undefined> }

export class Fields {
  static present<Given extends object>(fields: Given): Present<Given> {
    return Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ) as Present<Given>
  }

  static tenant(tenantId: string | null): { readonly tenantId?: string } {
    return tenantId === null ? {} : { tenantId }
  }
}
