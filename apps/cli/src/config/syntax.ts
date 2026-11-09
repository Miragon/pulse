/**
 * The character class the validators of the auth settings share (Basic auth, OAuth, bearer
 * tokens). Names, keys and values of a profile are the profile format's (@miragon/pulse-profile).
 */

/** Control characters (C0, DEL, C1): RFC 7617 and RFC 6749 forbid them in credentials. */
export const CONTROL = /\p{Cc}/u
