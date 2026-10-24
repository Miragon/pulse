// The Pulse docs site, built with the Miragon docs kit (docs/.vitepress/miragon/,
// vendored unchanged from Miragon/corporate-identity, skill docs-site). The kit sets
// everything else: base from DOCS_BASE (the repo name, set in .github/workflows/docs.yml),
// theme, colours light and dark, GitHub anchors, Mermaid, search, the legal row.
import { miragonDocs } from "./miragon/config"

export default miragonDocs({
  repo: "Miragon/pulse",
  // The product name. Miragon AI is the family of all tools, this repo is Pulse, and so
  // are its technical names (#415): the repo Miragon/pulse, the Docker image
  // ghcr.io/miragon/pulse-server, the @miragon/pulse-* packages and the MCP server
  // name "pulse".
  title: "Miragon Pulse",
  siteTitle: "Pulse",
  description:
    "Pulse, part of Miragon AI: operate and analyse your Camunda 7, CIB seven and Operaton engines from Claude, ChatGPT or any other MCP client.",
  productPage: "https://miragon.ai/tools/pulse/",
  footerMessage: "Released under the MIT License.",

  // README.md is the index for reading the pages on GitHub; the site's index is
  // index.md.
  srcExclude: ["README.md"],

  nav: [
    { text: "Getting started", link: "/getting-started" },
    { text: "Usage", link: "/usage" },
    { text: "Operations", link: "/operations" },
    { text: "Architecture", link: "/architecture" },
    { text: "Developers", link: "/developer" },
    { text: "CLI", link: "/cli/" },
  ],

  // One sidebar per part of the site, keyed by path: the CLI's pages under docs/cli/, the
  // server's pages at the root.
  sidebar: {
    "/cli/": [
      {
        text: "Getting started",
        items: [
          { text: "Getting started", link: "/cli/getting-started" },
          { text: "Quick start", link: "/cli/quick-start" },
          { text: "Installation", link: "/cli/installation" },
        ],
      },
      {
        text: "Commands",
        items: [
          { text: "Workflow commands", link: "/cli/workflow-commands" },
          { text: "Command structure", link: "/cli/commands" },
          { text: "Recipes", link: "/cli/recipes" },
          { text: "Output and errors", link: "/cli/output-and-errors" },
          { text: "Safety", link: "/cli/safety" },
        ],
      },
      {
        text: "Setup",
        items: [
          { text: "Configuration", link: "/cli/configuration" },
          { text: "Authentication", link: "/cli/authentication" },
          { text: "Engines", link: "/cli/engines" },
        ],
      },
      {
        text: "AI agents",
        items: [{ text: "Using the CLI from AI agents", link: "/cli/agents" }],
      },
      {
        text: "Contributing",
        collapsed: true,
        items: [
          { text: "Development", link: "/cli/development" },
          { text: "Architecture", link: "/cli/architecture" },
          { text: "Architecture decisions", link: "/cli/adr/" },
        ],
      },
    ],
    "/": [
      {
        text: "Start",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Usage", link: "/usage" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Operations", link: "/operations" },
          { text: "Architecture", link: "/architecture" },
          { text: "Developer guide", link: "/developer" },
        ],
      },
    ],
  },
})
