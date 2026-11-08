---
name: create-ticket
argument-hint: '[feature|bug|refactor] "<description>" | update <issue-number-or-url>'
allowed-tools: Bash(gh *), AskUserQuestion
description: Create or update a GitHub issue for Pulse using the `gh` CLI. Use when the user asks to "file a bug", "create a feature request", "open a GitHub issue", or "update an existing one". Supports feature, bug, and refactor issue types with structured templates; shows a draft for confirmation before creating or editing; looks up existing issues by number or URL for updates.
---

# Skill: create-ticket

Create or update a GitHub issue for this repository
(feature request, bug report, or refactor task).

## IMPORTANT

- Always use gh-cli to create or update tickets.
- Never call the api directly.
- If gh-cli not available, abort the execution and ask the user to install it. The user must restart the skill then.
- When any gh call fails, ask the user what to do (repeat, stop, do something else).

## Instructions

### Step 1: Determine mode

Inspect `$ARGUMENTS`:

- If context contains `update` and/or an issue number or GitHub issue URL, use update-mode.
- Otherwise use create-mode.
- If create-mode does not make sense based on your context, use AskUserQuestion to ask the user for more context.

### Step 2: Gather information

For a new issue:

- Extract the issue type (`feature`, `bug`, `refactor`) from `$ARGUMENTS`; if missing, ask the user.
- For `feature`: understand the desired behaviour and why it is needed.
- For `bug`: understand the current vs. expected behaviour and reproduction steps; ask about server version, affected module (engine/core/ui), and process engine (Camunda 7/CIB seven) if relevant.
- For `refactor`: understand the scope, motivation, and target state.

For an issue that needs to be updated:

- Fetch the issue using `gh issue view <number-or-url>`.

### Step 3: Research (optional)

If the issue involves a specific library, framework version, API, or configuration that you are not
fully certain about, ask the user:
_"Should I search online for [topic] to get accurate details (e.g. exact property names,
migration guides) before drafting?"_
If yes, use `WebSearch` / `WebFetch` to collect relevant facts, then incorporate them into the
draft. Skip this step if you already have sufficient knowledge.

### Step 4: Draft

Read the matching issue template from `.github/ISSUE_TEMPLATE/` to get the exact sections and labels:

- `feature` → `.github/ISSUE_TEMPLATE/feature_request.yml`
- `bug` → `.github/ISSUE_TEMPLATE/bug_report.yml`
- `refactor` → `.github/ISSUE_TEMPLATE/refactoring.yml`

Extract the `title` prefix, `labels`, and every `textarea`/`input`/`dropdown` field (`label` + `description`) from the YAML to compose the issue body. Fill each section with the information gathered in Step 2.

### Step 5: Show and confirm

Use `AskUserQuestion` to present the full draft (create) or the current state + proposed changes (update) and ask whether to proceed, edit, or cancel. Apply any requested edits and ask again before continuing.

### Step 6: Create or update

Using the GitHub CLI:

- **Create**: `gh issue create --title "<title>" --body "<body>" --label "<label>"`
- **Update** (use whichever commands apply):
  ```bash
  gh issue edit <number> --title "<title>" --body "<body>"
  gh issue edit <number> --add-label "<label>" --remove-label "<label>"
  gh issue comment <number> --body "<comment>"
  gh issue close <number>
  gh issue reopen <number>
  ```

### Step 7: Report

Run `gh issue view <number>` and show the final issue state with its URL.
