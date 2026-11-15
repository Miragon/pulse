type FileFailure = "missing" | "unreadable" | "former-name"

export type FileVerdict =
  | { readonly kind: "read"; readonly path: string; readonly text: string }
  | { readonly kind: FileFailure; readonly path: string }

export type UserConfigVerdict = Exclude<FileVerdict, { readonly kind: "former-name" }>
