import { config } from "./config.js";
import { endpoint } from "./telemetry.js";
import { collectTabs, skipReason } from "./tabs.js";

const group = document.querySelector("#group");
const summary = document.querySelector("#summary");
const body = document.querySelector("#tabs");
const notice = document.querySelector("#notice");
const discardGroup = document.querySelector("#discard-group");
const refresh = document.querySelector("#refresh");
const send = document.querySelector("#send");
const telemetryStatus = document.querySelector("#telemetry-status");
const uploadResult = document.querySelector("#upload-result");
const dateTime = new Intl.DateTimeFormat("en", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

let windowId;
let tabs = [];
let groups = [];
let busy = false;

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "The extension background worker did not return a result.");
  return response.result;
}

function addCell(row, value) {
  const cell = row.insertCell();
  cell.textContent = value;
  return cell;
}

function renderTabs() {
  const selection = group.value;
  const filtered = selection === "all" ? tabs : tabs.filter((tab) => String(tab.groupId) === selection);
  summary.textContent = `Current window · Total tabs: ${tabs.length} · Discarded: ${tabs.filter((tab) => tab.discarded).length}`;
  discardGroup.disabled = busy || Number(selection) < 0 || selection === "all" ||
    !filtered.some((tab) => !skipReason(tab));
  refresh.disabled = busy;
  group.disabled = busy;
  body.replaceChildren();
  if (!filtered.length) {
    addCell(body.insertRow(), "No matching tabs").colSpan = 4;
    return;
  }
  for (const tab of filtered) {
    const row = body.insertRow();
    const reason = skipReason(tab);
    addCell(row, tab.address ?? "—");
    addCell(row, reason || "Loaded in background");
    addCell(row, tab.lastAccessed ? dateTime.format(tab.lastAccessed) : "—");
    const button = document.createElement("button");
    button.textContent = "Discard";
    button.disabled = busy || Boolean(reason);
    button.addEventListener("click", () => runDiscard({ tabId: tab.id }));
    row.insertCell().append(button);
  }
}

async function load() {
  windowId ??= (await chrome.windows.getCurrent()).id;
  const selection = group.value;
  [tabs, groups] = await Promise.all([
    collectTabs({ windowId }, config.includeQueryAndFragment),
    chrome.tabGroups.query({ windowId }),
  ]);
  group.replaceChildren(new Option("All tabs", "all"));
  if (tabs.some((tab) => tab.groupId === -1)) group.add(new Option("Ungrouped", "-1"));
  for (const item of groups) {
    const count = tabs.filter((tab) => tab.groupId === item.id).length;
    group.add(new Option(`${item.title || "Unnamed group"} (${count})`, String(item.id)));
  }
  if (Array.from(group.options).some((option) => option.value === selection)) {
    group.value = selection;
  }
  renderTabs();
}

async function runDiscard(target) {
  busy = true;
  renderTabs();
  notice.textContent = "Discarding…";
  try {
    const result = await request({ type: "discard", windowId, ...target });
    const details = Object.entries(result.skipReasons).map(([reason, count]) => `${reason}: ${count}`);
    notice.textContent = `Discarded: ${result.discarded}, skipped: ${result.skipped}, failed: ${result.failed}.` +
      (details.length ? ` (${details.join(", ")})` : "");
    try {
      await load();
    } catch {
      notice.textContent += " Could not refresh the tab list. Click Refresh to try again.";
    }
  } catch (error) {
    notice.textContent = error.message;
  } finally {
    busy = false;
    renderTabs();
  }
}

group.addEventListener("change", renderTabs);
discardGroup.addEventListener("click", () => runDiscard({ groupId: Number(group.value) }));
refresh.addEventListener("click", () => {
  notice.textContent = "";
  load().catch((error) => { notice.textContent = error.message; });
});

try {
  if (endpoint()) {
    telemetryStatus.textContent = `Telegraf configured · Reports every ${config.snapshotIntervalMinutes} minutes`;
    send.disabled = false;
  } else {
    telemetryStatus.textContent = "Telegraf is unconfigured · Local view only";
  }
} catch (error) {
  telemetryStatus.textContent = error.message;
}

send.addEventListener("click", async () => {
  send.disabled = true;
  uploadResult.hidden = false;
  uploadResult.textContent = "Reporting…";
  try {
    const result = await request({ type: "snapshot" });
    uploadResult.textContent = result.status === "sent" ? `Tabs reported: ${result.count}.` :
      result.status === "empty" ? "No HTTP(S) tabs to report." : "Telegraf is unconfigured.";
  } catch (error) {
    uploadResult.textContent = error.message;
  } finally {
    send.disabled = false;
  }
});

load().catch((error) => { summary.textContent = error.message; });
