export type ProjectFileEdition = { readonly text: string } | { readonly problem: string }

export interface NamedProfile {
  readonly name: string
  readonly profile: Readonly<Record<string, unknown>>
}

type Json = Readonly<Record<string, unknown>>

const ROOT_ORDER: readonly string[] = ["$schema", "defaultProfile", "profiles"]

export class ProjectFileEdit {
  static withProfile(
    current: string | undefined,
    entry: NamedProfile,
    replacing?: string,
  ): ProjectFileEdition {
    const file = current === undefined ? {} : ProjectFileEdit.parsed(current)
    if (typeof file === "string") {
      return { problem: file }
    }
    const profiles = file.profiles ?? {}
    if (!ProjectFileEdit.isRecord(profiles)) {
      return { problem: "has profiles that are not an object" }
    }
    if (Object.hasOwn(profiles, entry.name) && entry.name !== replacing) {
      return { problem: `already has a profile named ${entry.name}` }
    }
    const others = Object.entries(profiles).filter(
      ([name]) => name === entry.name || name !== replacing,
    )
    const next = {
      ...file,
      profiles: { ...Object.fromEntries(others), [entry.name]: entry.profile },
    }
    return { text: `${JSON.stringify(ProjectFileEdit.ordered(next), undefined, 2)}\n` }
  }

  private static parsed(text: string): Json | string {
    let file: unknown
    try {
      file = JSON.parse(text)
    } catch {
      return "isn't valid JSON"
    }
    return ProjectFileEdit.isRecord(file) ? file : "doesn't hold a JSON object"
  }

  private static ordered(file: Json): Json {
    const known = ROOT_ORDER.filter((key) => Object.hasOwn(file, key))
    const rest = Object.keys(file).filter((key) => !ROOT_ORDER.includes(key))
    return Object.fromEntries([...known, ...rest].map((key) => [key, file[key]]))
  }

  private static isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
