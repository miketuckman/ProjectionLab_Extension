# AGENTS.md — ProjectionLab Extension

## Purpose

This repository is Mike Tuckman's security-hardened fork of
[Chrysalis](https://github.com/tyler-class/Chrysalis). It provides a local
ProjectionLab MCP integration backed by a Chrome extension that can read the
logged-in Monarch and ProjectionLab sessions, create recoverable snapshots, and
perform explicitly approved updates.

The extension and MCP server are a controlled data-access layer, not a financial-
planning engine. Monarch is the source for current operational balances,
ProjectionLab is the destination for long-range modeling, and plan analysis plus
Boldin comparison belongs in the separate retirement-planning workflow.

## Repository and Upstream

- `origin` is Mike's fork: `miketuckman/ProjectionLab_Extension`.
- `upstream` is the original project: `tyler-class/Chrysalis`.
- Preserve the upstream MIT license, attribution, and useful project history.
- Review upstream changes before merging them; do not overwrite local security
  controls merely to match upstream behavior.
- Keep personal configuration, account mappings, exports, API keys, sessions,
  and financial data out of Git and GitHub.

## Product Boundaries

- The initial writable capability is syncing balances into ProjectionLab
  accounts that already exist.
- Read access may cover the complete ProjectionLab export, including current
  finances, plans, progress, and settings, but tools should return focused views
  or snapshot handles instead of flooding model context with the full export.
- Future plan, progress, settings, and full-current-finances updates may use
  ProjectionLab's section-level restore APIs only through a versioned
  snapshot/diff/commit workflow. Never expose raw `restore*` calls directly as
  MCP tools.
- Do not create, delete, or restructure ProjectionLab plans or accounts until a
  separately reviewed tool contract and validation layer exists.
- Do not initiate financial transactions, move money, or make investment,
  retirement, tax, or legal decisions.
- Do not proxy Boldin through this MCP server. The retirement-planning session
  uses Boldin's official read-only MCP independently for cross-checking.
- Keep automatic or scheduled writes disabled unless Mike explicitly approves
  that behavior after the MCP preview/commit workflow is proven.

## Security and Privacy

- Never print, commit, transmit, or place the ProjectionLab API key or Monarch
  session material in prompts, logs, fixtures, screenshots, or error reports.
- Store the ProjectionLab API key with `chrome.storage.local`, not
  `chrome.storage.sync`, so it does not roam through the Chrome profile.
- Reuse only the user's active Monarch browser session. Do not store a Monarch
  password, session token, or cookie, and do not request the Chrome `cookies`
  permission.
- Restrict host permissions and network requests to the minimum required
  Monarch and ProjectionLab origins. Do not add analytics, telemetry, advertising,
  remote logging, or third-party service endpoints.
- Treat account names, balances, mappings, cost basis, and sync history as
  sensitive financial data. Minimize retention and make deletion straightforward.
- Use synthetic data for development and tests. Real exports remain local,
  unchanged, untracked, and outside this repository.

## Write-Safety Rules

- Separate reads, preview, approval, and writes into distinct steps.
- Before every live write, create a fresh ProjectionLab snapshot in the local
  snapshot store. Existing manual backups provide disaster recovery; the fresh
  snapshot provides precise rollback for the current operation.
- Present a per-account preview showing source account, destination account,
  old value, proposed value, difference, and field to be changed.
- Require an explicit user confirmation immediately before a live sync.
- Permit only a documented allowlist of balance and, when explicitly approved,
  cost-basis fields. Reject unknown fields rather than using `force: true`.
- Bind every preview to an export hash and short expiration. Abort on missing
  accounts, ambiguous mappings, stale previews, changed ProjectionLab state,
  invalid values, or partial source retrieval. Never silently apply a partial
  sync.
- Produce a local sync receipt that distinguishes reads, proposed changes,
  successful writes, skipped accounts, and failures without exposing secrets.

## Architecture

- This project combines a Chrome Manifest V3 extension, a Chrome Native
  Messaging host, and a local stdio MCP server.
- `content-scripts/monarch.js` reads balances from the logged-in Monarch tab.
- `background/service-worker.js` coordinates mappings and ProjectionLab writes.
- `native-host/` bridges the extension to local clients over a user-only Unix
  domain socket; Chrome Native Messaging owns its stdin/stdout.
- `mcp-server/` is the Codex-facing stdio MCP server and never receives browser
  passwords, cookies, session tokens, or the ProjectionLab API key.
- `shared/` contains deterministic protocol, export, mapping, preview, hashing,
  and validation logic shared where practical.
- `setup/` owns API-key entry, account discovery, and mappings.
- `popup/` reports setup and MCP readiness; it does not expose a direct write
  button.
- `sync-history/` owns local receipts and retention controls.
- Prefer small, testable modules over adding a framework unless the benefit is
  demonstrated and approved.

## Development Workflow

- Diagnose and document the live behavior before editing it.
- Keep security hardening separate from feature enhancement where practical so
  changes remain reviewable.
- Do not modify live browser extension state, install an unpacked build, enter
  credentials, or run a real sync without Mike's explicit approval.
- Registering the native host or MCP server in global Codex configuration is a
  separate installation step and requires explicit approval.
- Do not publish the fork to the Chrome Web Store or another distribution channel
  without explicit approval.
- Use `rg` for repository searches and `apply_patch` for hand-authored edits.
- Preserve unrelated user changes in a dirty worktree.
- Do not commit unless Mike explicitly requests a commit.

## Verification

- Run `node --check` on every changed JavaScript file.
- Add automated tests for extracted pure logic, especially account mapping,
  field allowlisting, numeric validation, aggregation, preview generation, and
  stale-preview detection.
- Validate `manifest.json` after permission or entry-point changes.
- Inspect all network targets and secret-storage calls before each release.
- Test the native-message framing, Unix-socket bridge, MCP schemas, timeouts,
  reconnects, and concurrent read clients without using financial data.
- Use an unpacked extension in a dedicated Chrome profile for browser QA.
- Test with synthetic accounts first, then a read-only live discovery pass, then
  one explicitly approved low-risk account before a full sync.
- Never claim a live balance was updated without confirming the resulting value
  in ProjectionLab and recording the outcome in the local receipt.

## Retirement-Planning Integration

- The globally registered local MCP server supplies focused ProjectionLab reads,
  current balances, snapshot handles, previews, and verifiable write receipts;
  it does not supply planning assumptions or recommendations.
- The retirement-planning project owns ProjectionLab exports, normalization,
  scenario analysis, and comparison with Boldin.
- The retirement-planning session may query ProjectionLab through MCP alongside
  Boldin MCP. Full exports remain local snapshots and are referenced by ID/hash.
- The retirement-planning session must disclose the accounts used, assumptions,
  calculation differences, and uncertainty when reconciling ProjectionLab with
  Boldin.
- Never treat ProjectionLab return assumptions or scenario paths as realized
  investment performance.

## Initial Roadmap

1. Establish a documented, unchanged upstream baseline.
2. Move secrets and mappings from synced to local-only storage.
3. Add the Native Messaging and stdio MCP bridge with status and focused read
   tools.
4. Replace forced writes with field allowlisting and strict validation.
5. Add snapshot-backed balance-sync preview and commit tools with stale-state
   protection and privacy-conscious receipts.
6. Add automated tests and complete synthetic protocol, MCP, and browser QA.
7. Perform one narrowly approved live sync and validate the retirement-planning
   handoff.
8. Design plan/settings patch tools on top of section-level snapshots and
   restores as a separate milestone.
