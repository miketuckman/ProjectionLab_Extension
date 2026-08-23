# ProjectionLab Local MCP

## Architecture

The Codex-facing process uses MCP over stdio. It connects to a user-only Unix
domain socket owned by a Chrome Native Messaging host. The host forwards typed
requests to the unpacked extension, which performs reads and approved writes in
the logged-in Monarch and ProjectionLab tabs.

The ProjectionLab API key remains in `chrome.storage.local`. Monarch credentials,
cookies, and session tokens never enter the MCP process. Complete ProjectionLab
exports are stored with mode `0600` under:

`~/Library/Application Support/ProjectionLab MCP/snapshots/`

## Local installation

Installation changes Chrome and global Codex configuration, so do it only after
the code and tests have been reviewed.

1. Run `npm install` in this repository.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select this repository. The deterministic extension ID should be
   `pnkoflgnpogkfifbkgjmhkcjilddfaol`.
3. Run `npm run install:native-host`, then restart Chrome.
4. In the extension setup, enable ProjectionLab Plugins, save the API key, load
   both account lists, and create the desired mappings.
5. Register the MCP server globally:

   ```sh
   codex mcp add projectionlab -- node /Users/michaeltuckman/Desktop/Projects/ProjectionLab_Extension/mcp-server/index.js
   ```

6. Configure the server in `~/.codex/config.toml` with
   `default_tools_approval_mode = "writes"` and `tool_timeout_sec = 120`, then
   restart Codex and verify it with `/mcp`.

## Balance-sync workflow

1. Call `pl_status` and resolve any missing browser tab, key, or mapping.
2. Call `pl_list_accounts` when focused current values are needed.
3. Call `pl_preview_balance_sync`. This creates a full local rollback snapshot
   and returns every proposed field-level change.
4. Review the preview with Mike. Do not infer approval from earlier conversation.
5. Call `pl_apply_balance_sync` with the returned preview and snapshot IDs plus
   the exact confirmation phrase. The extension rejects expired previews and any
   state change since the preview.
6. Inspect the saved receipt and verify the resulting ProjectionLab values.

No live sync has been authorized merely by installing or testing this project.
