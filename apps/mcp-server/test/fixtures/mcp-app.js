// Minimal widget-bundle stand-in for the in-process e2e boots: the composed boot
// primes every view resource with this file's contents at startup (the
// bundle is read once, never executed by the server), so the tests exercise the
// real view/resource wiring without building the actual UI bundle.
export default function fixtureApp() {
  return "mcp-app fixture"
}
