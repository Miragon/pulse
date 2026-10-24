/** Types for the JavaScript API of postject (https://github.com/nodejs/postject), which has none. */
declare module 'postject' {
  export interface InjectOptions {
    /** Mach-O segment of the resource (macOS only). */
    readonly machoSegmentName?: string;
    readonly overwrite?: boolean;
    /** Marker in the executable that is flipped to tell it a resource was injected. */
    readonly sentinelFuse?: string;
  }

  /** Injects `resourceData` into the executable at `filename` (ELF, PE or Mach-O), in place. */
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Buffer,
    options?: InjectOptions,
  ): Promise<void>;
}
