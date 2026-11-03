/**
 * Engine failure text for the model: a Java stacktrace condensed to its user frames, and any
 * failure text (a trace or a worker's error details) bounded in size. The incident-issue draft,
 * the job stacktrace tool and the inspect composite all show it this way.
 */

/**
 * Worker error details can be any size and the draft reaches the model in full, so a longer
 * text keeps its head (the error) and its tail (the root cause in a Java trace).
 */
const MAX_FAILURE_TEXT = 6000
const FAILURE_TEXT_TAIL = 1500

export function boundFailureText(text: string): string {
  if (text.length <= MAX_FAILURE_TEXT) return text
  const head = text.slice(0, MAX_FAILURE_TEXT - FAILURE_TEXT_TAIL)
  const tail = text.slice(-FAILURE_TEXT_TAIL)
  const cut = text.length - head.length - tail.length
  return `${head}\n… [${cut} characters truncated] …\n${tail}`
}

/** Framework frames are dropped unless that would leave a section empty. */
const FRAMEWORK_FRAME_PATTERNS = [
  /^\s*at (java|javax|jakarta|jdk|sun|com\.sun)\./,
  /^\s*at org\.springframework\./,
  /^\s*at org\.apache\.(catalina|tomcat|coyote)\./,
  /^\s*at org\.eclipse\.jetty\./,
  /^\s*at io\.netty\./,
  /^\s*at reactor\./,
  /^\s*at org\.junit\./,
  /^\s*at \w+\$\$EnhancerByCGLIB\$\$|^\s*at .*\$\$Lambda\$/,
  /^\s*at org\.camunda\.|^\s*at org\.cibseven\./,
]
const FRAMES_PER_EXCEPTION = 8

function isFrame(line: string): boolean {
  return /^\s*at /.test(line)
}

function isFrameworkFrame(line: string): boolean {
  return FRAMEWORK_FRAME_PATTERNS.some((re) => re.test(line))
}

function pickFrames(frames: string[]): string[] {
  const userFrames = frames.filter((f) => !isFrameworkFrame(f))
  const picked = userFrames.length > 0 ? userFrames : frames
  return picked.slice(0, FRAMES_PER_EXCEPTION)
}

export function condenseStacktrace(raw: string): string {
  const lines = raw.split(/\r?\n/)
  // Free text (a worker's error details) has no frames to trim — keep it whole.
  if (!lines.some(isFrame)) return raw.trim()
  const sections: { head: string; frames: string[] }[] = []
  let current: { head: string; frames: string[] } | null = null

  for (const line of lines) {
    if (!line.trim()) continue
    const isCausedBy = /^\s*Caused by:/.test(line)
    const isSuppressed = /^\s*Suppressed:/.test(line)
    if (!current || isCausedBy || isSuppressed) {
      if (isFrame(line) && current) {
        current.frames.push(line)
      } else {
        current = { head: line, frames: [] }
        sections.push(current)
      }
      continue
    }
    if (isFrame(line)) current.frames.push(line)
    // Non-frame, non-section-head lines (e.g. "... 42 more") are dropped.
  }

  const out: string[] = []
  let droppedFrames = 0
  for (const section of sections) {
    out.push(section.head)
    const kept = pickFrames(section.frames)
    out.push(...kept)
    droppedFrames += section.frames.length - kept.length
  }
  if (droppedFrames > 0) {
    out.push(`\t... ${droppedFrames} framework/internal frames trimmed`)
  }
  return out.join("\n")
}
