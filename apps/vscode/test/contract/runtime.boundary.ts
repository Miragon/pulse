// @ts-expect-error runs in any JavaScript host, so the DOM is not there
export const theDom: unknown = document;
// @ts-expect-error runs in any JavaScript host, so Node is not there
export const node: unknown = process;
