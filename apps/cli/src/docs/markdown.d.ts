/** A docs page imported as text: the bundler and the test runner load `.md` files as a string. */
declare module "*.md" {
  const text: string
  export default text
}
