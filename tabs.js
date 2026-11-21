export function tabAddress(rawAddress, includeQueryAndFragment) {
  try {
    const url = new URL(rawAddress);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    url.username = "";
    url.password = "";
    if (!includeQueryAndFragment) {
      url.search = "";
      url.hash = "";
    }
    return url.href;
  } catch {
    return null;
  }
}

function tabInfo(tab, includeQueryAndFragment = false) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    groupId: tab.groupId,
    address: tabAddress(tab.url, includeQueryAndFragment),
    activeInWindow: tab.active,
    lastAccessed: Number.isFinite(tab.lastAccessed) ? tab.lastAccessed : null,
    discarded: tab.discarded,
    pinned: tab.pinned,
    audible: tab.audible,
  };
}

export async function collectTabs(query = {}, includeQueryAndFragment = false) {
  const tabs = await chrome.tabs.query(query);
  return tabs.filter((tab) => !tab.incognito).map((tab) => tabInfo(tab, includeQueryAndFragment));
}

export function skipReason(tab) {
  if (!tab.address) return "Unsupported or unavailable URL";
  if (tab.activeInWindow) return "Active in window";
  if (tab.discarded) return "Already discarded";
  if (tab.pinned) return "Pinned";
  if (tab.audible) return "Playing audio";
  return "";
}

export async function discardTabs(windowId, target) {
  const query = { windowId };
  if (target.groupId !== undefined) query.groupId = target.groupId;
  const candidates = await collectTabs(query);
  const selected = candidates.filter((tab) => target.tabId === undefined || tab.id === target.tabId);
  const result = { discarded: 0, failed: 0, skipped: 0, skipReasons: {} };

  for (const candidate of selected) {
    let tab;
    try {
      // Recheck by tab ID because tabs can close, move, or change groups during a group operation.
      const current = await chrome.tabs.get(candidate.id);
      if (!current.incognito && current.windowId === windowId &&
          (target.groupId === undefined || current.groupId === target.groupId)) {
        tab = tabInfo(current);
      }
    } catch {
      tab = undefined;
    }
    const reason = tab ? skipReason(tab) : "Tab closed or moved out of scope";
    if (reason) {
      result.skipped++;
      result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
      continue;
    }
    try {
      const discarded = await chrome.tabs.discard(candidate.id);
      if (discarded?.discarded) result.discarded++;
      else result.failed++;
    } catch {
      result.failed++;
    }
  }
  if (!selected.length && target.tabId !== undefined) {
    result.skipped = 1;
    result.skipReasons["Tab closed or moved out of scope"] = 1;
  }
  return result;
}
