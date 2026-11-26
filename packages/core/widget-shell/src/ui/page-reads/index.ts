// A page's reads outside a chat: each section reads on its own through the page's one query
// client, a refusal of a connection is one state for the page, and every failure is worded by the
// kit. Host-agnostic: whatever the page's caller (an artifact runtime, a recording) refuses, it
// refuses as a `PageCallError`.
export { PageCallError, type PageCallSite } from "./page-call-error.js"
export { createPageReader, type PageReader, type PageReaderOptions } from "./page-reader.js"
export { useSectionRead, type SectionRead } from "./section-read.js"
export { PageGate, usePageReads, type PageGateProps, type PageReads } from "./page-gate.js"
export { describePageFailure, type DescribePageFailureOptions } from "./describe-page-failure.js"
