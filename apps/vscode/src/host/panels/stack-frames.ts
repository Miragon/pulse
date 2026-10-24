export interface StackFrame {
  readonly line: number
  readonly start: number
  readonly end: number
  readonly sourceGlob: string
  readonly sourceLine: number
}

export interface ClassMention {
  readonly line: number
  readonly start: number
  readonly end: number
  readonly className: string
}

const FRAME = /\bat\s+((?:[\w$]+\.)+)[\w$<>]+\(([\w$]+\.(?:java|kt|groovy|scala)):(\d+)\)/
const FRAME_CLASS = /\bat\s+((?:[\w$]+\.)+[\w$]+)\.[\w$<>]+\(/
const THROWN_CLASS = /^(?:Caused by:\s+|Suppressed:\s+)?((?:[a-z_$][\w$]*\.)+[A-Z][\w$]*)(?::|$)/
const PLATFORM_PACKAGES = /^(?:java|javax|jdk|sun|jakarta|kotlin|org\.springframework)\./

export class StackFrames {
  static in(text: string): StackFrame[] {
    return StackFrames.lines(text).flatMap((line, index) => {
      const frame = StackFrames.frameOf(line, index)
      return frame === undefined ? [] : [frame]
    })
  }

  static classesIn(text: string): ClassMention[] {
    return StackFrames.lines(text).flatMap((line, index) => {
      const className = (FRAME_CLASS.exec(line) ?? THROWN_CLASS.exec(line.trim()))?.[1]
      if (className === undefined || PLATFORM_PACKAGES.test(className)) {
        return []
      }
      const start = line.indexOf(className)
      return [{ line: index, start, end: start + className.length, className }]
    })
  }

  private static lines(text: string): string[] {
    return text.split(/\r?\n/)
  }

  private static frameOf(text: string, line: number): StackFrame | undefined {
    const match = FRAME.exec(text)
    const [, qualifiedClass = "", fileName = "", lineNumber = "0"] = match ?? []
    if (match === null || PLATFORM_PACKAGES.test(qualifiedClass)) {
      return undefined
    }
    const packagePath = qualifiedClass.split(".").slice(0, -2).join("/")
    const location = `${fileName}:${lineNumber}`
    const start = text.indexOf(location)
    return {
      line,
      start,
      end: start + location.length,
      sourceGlob: `**/${packagePath === "" ? "" : `${packagePath}/`}${fileName}`,
      sourceLine: Number(lineNumber),
    }
  }
}
