/**
 * The types of scripts/third-party-licenses.mjs, the licence list every artifact ships as its
 * THIRD_PARTY_LICENSES.txt, for the TypeScript of the artifacts' generators and drift tests.
 */

/** The file name every artifact ships its list under. */
export declare const LICENCES_FILE_NAME: "THIRD_PARTY_LICENSES.txt"

/** A licence or notice file of a work, by its file name, its text with LF line ends. */
export interface LicenceText {
  readonly file: string
  readonly text: string
}

/** A work of someone else, with the files its licence asks to ship along. */
export interface Work {
  readonly name: string
  readonly version: string
  /** Its licence as an SPDX expression. */
  readonly licence: string
  readonly source: string | undefined
  /** What of it the artifact holds, where that is not simply its code. */
  readonly holds: string | undefined
  readonly texts: readonly LicenceText[]
  /** Where its licence files come from when the work ships none itself. */
  readonly textsFrom?: string
}

/** A work an artifact holds, with the bundles that hold it, in the order the layout lists them. */
export interface ThirdParty extends Work {
  readonly bundles: readonly string[]
}

export interface Inventory {
  /** Sorted by name, case aside. */
  readonly thirdParty: readonly ThirdParty[]
  /** Pulse's own packages the bundles hold, under the artifact's licence. */
  readonly own: readonly string[]
  /** The artifact's dependencies as `<name> <version>`: what npm installs beside it. */
  readonly installed: readonly string[]
}

/** The licence and notice files of a work that ships none: a folder of the repository. */
export interface LicenceFiles {
  /** The folder, relative to the repository. */
  readonly dir: string
  /** Where the copies come from, as the list says it. */
  readonly from: string
}

/** Where the inventory looks; real paths, as the bundler reports its modules. */
export interface Layout {
  readonly repo: string
  /** The package of the artifact: its files are its own, its licence the one its Pulse packages share. */
  readonly home: string
  /** The names of the artifact's bundles, in the order the list names them. */
  readonly bundles: readonly string[]
  /** A virtual module of the bundler, by its id: the directory of the package that writes it. */
  readonly virtual: Readonly<Record<string, { readonly dir: string; readonly holds: string }>>
  /**
   * A module that carries another work's text, by its path in the repository (an entry that ends
   * in `/` takes every module below it): the work, read when a bundle holds the module.
   */
  readonly embedded: Readonly<Record<string, () => Work>>
  /** The copies of the licence files of a package that ships none, by `<name>@<version>`. */
  readonly licenceFiles?: Readonly<Record<string, LicenceFiles>>
}

/** An OpenAPI document beside its licence files, whose text a module carries. */
export interface OpenApiSource {
  readonly dir: string
  /** The document in `dir` whose `info` names the work, its version and its licence. */
  readonly spec: string
  /** The licence as an SPDX id, and as the document's `info.license.name` spells it. */
  readonly licence: string
  readonly licenceName: string
  readonly holds: string
  readonly source: string
}

/** What an artifact's list says around its works. */
export interface LicenceFileText {
  /** The command that writes the file, named in each finding. */
  readonly regenerate: string
  readonly intro: readonly string[]
  /** A paragraph after the summary, before the works' licences; none when empty. */
  readonly notes: readonly string[]
  /** The artifacts a set of bundles reaches, by the bundles' names joined with a space. */
  readonly artifacts: Readonly<Record<string, string>>
  readonly titles: {
    readonly works: string
    readonly own: string
    /** The section of the dependencies npm installs beside the artifact; left out without a title. */
    readonly installed?: string
  }
}

export declare function normalized(text: string): string
export declare function licenceTexts(dir: string, work: string): LicenceText[]
export declare function originOf(
  id: string,
  layout: Layout,
):
  | { readonly kind: "own"; readonly packageDir?: string }
  | { readonly kind: "third-party"; readonly dir: string; readonly holds?: string }
export declare function openApiWork(source: OpenApiSource): Work
export declare function repoPath(id: string, layout: Layout): string
export declare function inventoryOf(
  modules: Readonly<Record<string, readonly string[]>>,
  layout: Layout,
): Inventory
export declare function renderLicences(inventory: Inventory, text: LicenceFileText): string
export declare function listedWorks(text: string): string[]
export declare function licenceFindings(
  current: string,
  inventory: Inventory,
  text: LicenceFileText,
): string[]
export declare function openApiTexts(node: unknown, min: number): string[]

/** An output chunk of rolldown, rollup or Vite, as far as the list reads it. */
export interface RenderedChunk {
  readonly type: "chunk" | "asset"
  readonly moduleIds?: readonly string[]
  readonly modules?: Readonly<Record<string, { readonly renderedLength: number } | undefined>>
}
export declare function renderedModules(chunks: readonly RenderedChunk[]): string[]
