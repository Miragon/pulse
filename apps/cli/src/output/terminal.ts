/**
 * Text for a terminal. Response bodies are data controlled by whoever deploys resources or writes
 * variables; printed raw, escape sequences in them could set the window title, clear the screen
 * or write the clipboard (OSC 52) of the human running operate. Pipes and files get the raw bytes.
 */

/** C0 controls except tab and line feed, DEL, and the C1 controls (`\x9b` starts a sequence too). */
const CONTROL = /[^\P{Cc}\t\n]/gu;

/** Shown in place of a control character. */
const REPLACEMENT = '�';

/** Replaces control characters (except tab and line feed) with U+FFFD; CRLF becomes LF. */
export function terminalSafe(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(CONTROL, REPLACEMENT);
}
