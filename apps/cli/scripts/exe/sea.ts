/**
 * Targets and settings of the standalone executables: Node.js single executable
 * applications (https://nodejs.org/api/single-executable-applications.html), built with
 * `--experimental-sea-config` and postject, the workflow of Node.js 24.
 */

/**
 * Release asset name per target (`<process.platform>-<process.arch>`); each target builds on a
 * native runner. `macos` and `windows` rather than `darwin` and `win32`: people look for those.
 */
const ASSET_NAMES: Readonly<Record<string, string>> = {
  "linux-x64": "pulse-cli-linux-x64",
  "linux-arm64": "pulse-cli-linux-arm64",
  "darwin-x64": "pulse-cli-macos-x64",
  "darwin-arm64": "pulse-cli-macos-arm64",
  "win32-x64": "pulse-cli-windows-x64.exe",
}

/** Every release target, `<process.platform>-<process.arch>`. */
export const EXE_TARGETS: readonly string[] = Object.keys(ASSET_NAMES)

/** Resource name, sentinel fuse and Mach-O segment that Node.js looks for at start-up. */
export const SEA_RESOURCE = "NODE_SEA_BLOB"
export const SEA_SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
const SEA_MACHO_SEGMENT = "NODE_SEA"

export interface ExeTarget {
  /** Release asset name: `pulse-cli-<os>-<arch>`, plus `.exe` on Windows. */
  readonly fileName: string
  /**
   * Mach-O (macOS): postject needs the segment name, the signature of the copied node binary has
   * to go before the injection, and the result needs a new one (ad hoc) or arm64 refuses to run it.
   */
  readonly macho: boolean
}

/** The target for a platform and architecture; fails for one the release does not build. */
export function exeTarget(platform: string, arch: string): ExeTarget {
  const key = `${platform}-${arch}`
  const fileName = ASSET_NAMES[key]
  if (fileName === undefined) {
    throw new Error(`No standalone executable for ${key}; targets: ${EXE_TARGETS.join(", ")}`)
  }
  return { fileName, macho: platform === "darwin" }
}

/** The SEA configuration file read by `node --experimental-sea-config`. */
export interface SeaConfig {
  readonly main: string
  readonly output: string
  readonly disableExperimentalSEAWarning: true
  readonly useSnapshot: false
  readonly useCodeCache: true
}

/**
 * Configuration for the preparation blob of `main` (a CommonJS bundle). The V8 code cache makes
 * the start faster and is valid only on the platform that built it, which is why every target
 * builds on its own runner. No warning on stderr: agents read stderr.
 */
export function seaConfig(main: string, blob: string): SeaConfig {
  return {
    main,
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
  }
}

/**
 * The libraries a Node.js build links dynamically instead of embedding: the `node_shared*` flags
 * of `process.config.variables` that are on (`node_shared` is libnode). Distribution packages and
 * Homebrew build Node.js that way, and an executable copied from such a build needs the same
 * libraries on every machine it runs on. Official builds (nodejs.org, setup-node, nvm) link none.
 */
export function sharedLibraries(variables: object): string[] {
  return Object.entries(variables)
    .filter(([key, value]) => key.startsWith("node_shared") && value === true)
    .map(([key]) => key)
}

/** postject options for the target. */
export function injectOptions(target: ExeTarget): {
  readonly sentinelFuse: string
  readonly machoSegmentName?: string
} {
  return target.macho
    ? { sentinelFuse: SEA_SENTINEL_FUSE, machoSegmentName: SEA_MACHO_SEGMENT }
    : { sentinelFuse: SEA_SENTINEL_FUSE }
}
