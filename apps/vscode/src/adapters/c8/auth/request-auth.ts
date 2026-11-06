export interface RequestAuth {
  header(): Promise<string | undefined>
  rejected(header: string): boolean
}
