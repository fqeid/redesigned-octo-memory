import { config } from "./config.js";
import { collectTabs } from "./tabs.js";

export function endpoint() {
  if (!config.telegrafUrl.trim()) return null;
  const url = new URL(config.telegrafUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" &&
      !(url.protocol === "http:" && loopback))) {
    throw new Error("Use HTTPS for the Telegraf URL. HTTP is allowed for loopback testing. Leave credentials out of the URL.");
  }
  return url.href;
}

function lineString(value) {
  return '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
}

export function snapshotLines(tabs, identity, capturedAt) {
  const timestamp = String(capturedAt) + "000000";
  const common = [
    "browser_id=" + lineString(identity.browserId),
    "snapshot_id=" + lineString(identity.snapshotId),
    "extension_version=" + lineString(identity.version),
  ].join(",");
  return tabs.filter((tab) => tab.address !== null).map((tab, row) => {
    const fields = [
      common,
      "row_index=" + row + "i",
      "url=" + lineString(tab.address),
      "active_in_window=" + tab.activeInWindow,
      "discarded=" + tab.discarded,
    ];
    if (tab.lastAccessed !== null) fields.push("last_accessed_ms=" + tab.lastAccessed + "i");
    return "edge_tab_snapshot " + fields.join(",") + " " + timestamp;
  });
}

async function uploadSnapshot() {
  const url = endpoint();
  if (!url) return { status: "disabled" };
  const tabs = await collectTabs({ windowType: "normal" }, config.includeQueryAndFragment);
  const capturedAt = Date.now();
  if (!tabs.some((tab) => tab.address !== null)) return { status: "empty" };

  const saved = await chrome.storage.local.get("browserId");
  const browserId = saved.browserId || crypto.randomUUID();
  if (!saved.browserId) await chrome.storage.local.set({ browserId });
  const lines = snapshotLines(tabs, {
    browserId,
    snapshotId: crypto.randomUUID(),
    version: chrome.runtime.getManifest().version,
  }, capturedAt);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=UTF-8" },
      body: lines.join("\n") + "\n",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new Error("Could not connect to Telegraf. Check the URL, network, and host permissions.");
  }
  if (!response.ok) throw new Error("Telegraf returned HTTP " + response.status + ".");
  return { status: "sent", count: lines.length };
}

let uploadInProgress;
export function sendSnapshot() {
  uploadInProgress ??= uploadSnapshot().finally(() => { uploadInProgress = undefined; });
  return uploadInProgress;
}
