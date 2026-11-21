# Edge Tab Management POC

This Microsoft Edge extension discards background tabs individually or by native tab group. Its popup shows each tab’s top-level URL, last activation time, and discard status. Optional telemetry sends tab snapshots to Telegraf for ingestion through the existing ClickHouse pipeline.

## Install and test

1. Clone the repository or extract the ZIP, then open `edge://extensions/` in desktop Edge.
2. Turn on **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`.
3. Put two test tabs in the same Edge tab group and leave at least one in the background. Open the extension from the toolbar, select the group, and click **Discard selected group**. You can also click **Discard** next to an individual tab.

The extension skips the selected tab in each window, tabs that are already discarded, pinned tabs, tabs playing audio, and non-HTTP(S) pages. Discarded tabs stay in the tab strip and reload when selected again.

The popup lists tabs in the current window. **Last active** uses the browser’s `lastAccessed` timestamp, which records when a tab last became the selected tab in its window. The window may have been in the background. The timestamp applies to the tab across navigations and does not measure reading time or clicks.

## Configure Telegraf

`telegrafUrl` in `config.js` is blank by default. The popup and discard controls work locally with telemetry disabled.

1. Set `telegrafUrl` in `config.js` to an internal HTTPS endpoint, such as `https://metrics.example.com/edge-tabs`. Replace the placeholder entry in `manifest.json` under `host_permissions` with the matching origin pattern, such as `https://metrics.example.com/*`. For local testing, use a URL such as `http://localhost:8186/edge-tabs` and the permission `http://localhost/*`.
2. Reuse an existing Influx Line Protocol endpoint or add the following input to Telegraf. This example binds to loopback and assumes the production HTTPS endpoint forwards requests to Telegraf on the same host.

   ```toml
   [[inputs.http_listener_v2]]
     service_address = "tcp://127.0.0.1:8186"
     paths = ["/edge-tabs"]
     methods = ["POST"]
     data_format = "influx"
   ```

3. Reload the extension in Edge and click **Report all windows**. Once configured, the extension also uploads a snapshot every five minutes by default.

Requests time out after five seconds. A failed upload drops that snapshot, and the next scheduled upload proceeds as usual. Discarding tabs works independently of the upload.

## Snapshot fields

The measurement is `edge_tab_snapshot`. Each snapshot contains one row per HTTP(S) tab across all regular windows in the current Edge profile.

| Field | Description |
| --- | --- |
| Timestamp | Snapshot capture time, encoded in nanoseconds for Influx Line Protocol. |
| `browser_id` | Random ID generated when reporting first runs and stored locally. It identifies the extension installation and is independent of any user account. |
| `snapshot_id` | Random ID shared by all rows in the same snapshot. |
| `row_index` | Row number within the snapshot. Tabs with the same URL still produce separate rows. |
| `url` | Top-level URL. By default, it keeps the scheme, host, port, and path and removes credentials, the query string, and the fragment. |
| `active_in_window` | Whether the tab is selected in its window, regardless of whether that window is in the foreground. |
| `discarded` | Whether the tab has been discarded. |
| `last_accessed_ms` | Last activation time in milliseconds since the Unix epoch. Omitted if the browser does not provide it. |
| `extension_version` | Installed extension version. |

Set `includeQueryAndFragment` in `config.js` to `true` to include URL query strings and fragments. Credentials embedded in URLs are always removed. The extension uses the `tabs` permission to read top-level URLs. It does not read page titles or inject scripts into pages. Group names appear only in the popup and are excluded from telemetry.
