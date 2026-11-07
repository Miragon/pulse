/**
 * What the boot wraps around a callback a module hands its resources and prompts. The SDK answers
 * a request from what such a callback returns or throws, and some of that it cannot answer: a result
 * without its array (`undefined`, `null`) or a thrown `undefined` ends in its error path, with the
 * request open until the drain cuts it and nothing in the log. Here each gets an answer that names
 * the module, and a failure reaches the log with its stack. A tool needs none of this: the SDK turns
 * whatever its callback does into a result.
 */
import { isInputRequiredResult, ProtocolError } from "@modelcontextprotocol/server"

/** Why a callback's result cannot go out, as the end of a sentence about it; else `undefined`. */
type ResultCheck = (result: unknown) => string | undefined

/**
 * A `ProtocolError` is a module's deliberate answer (a resource not found, say): its code and data
 * are what the client acts on. Anything else is a failure: its stack goes to the log, its message to
 * the client as a tool's does, and whatever else it carries (a `data` with a password, say) nowhere.
 */
function answerable(subject: string, thrown: unknown): Error {
  if (thrown instanceof ProtocolError) return thrown
  console.error(`${subject} failed:`, thrown)
  const message = thrown instanceof Error ? thrown.message : ""
  return new Error(message || `${subject} failed.`)
}

/** `callback` with what it throws made answerable and what it returns held to `check`. */
export function guardedCallback<TArgs extends unknown[], TResult>(
  subject: string,
  callback: (...args: TArgs) => TResult | Promise<TResult>,
  check: ResultCheck = () => undefined,
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    let result: TResult
    try {
      result = await callback(...args)
    } catch (thrown) {
      throw answerable(subject, thrown)
    }
    const problem = check(result)
    if (problem !== undefined) throw new Error(`${subject} ${problem}.`)
    return result
  }
}

/** The check for a result that must hold `field`, the array the protocol requires of it. */
export const holdsArray =
  (field: "contents" | "messages"): ResultCheck =>
  (result) =>
    isInputRequiredResult(result) ||
    Array.isArray((result as Record<string, unknown> | null | undefined)?.[field])
      ? undefined
      : `returned no ${field} array`
