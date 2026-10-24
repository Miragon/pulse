// @ts-expect-error runs in the webview sandbox, so Node is not there
export const node: unknown = process;
