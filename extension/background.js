const API_BASE = "http://localhost:8000";
const PAUSE_DURATION = 5 * 60 * 1000;

let paused = false;
let processing = false;
let currentTabId = null;
let currentItem = null;

const ENRICH_INTERVAL_MS = 8000;
const ENRICH_SESSION_LIMIT = 50;

let enrichQueue = [];
let enrichProcessing = false;
let enrichSessionCount = 0;
let enrichPaused = false;
let enrichCurrentTabId = null;

let syncInProgress = false;

let postScanSyncState = {
  active: false,
  sentSlugs: null,
  connectedSlugs: null,
  sentTabId: null,
  connectedTabId: null,
};

function log(...args) {
  console.log("[XRay]", new Date().toISOString(), ...args);
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: color });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

async function pollQueue() {
  log("pollQueue called, paused:", paused, "processing:", processing);
  if (paused || processing) return;

  try {
    log("Fetching queue...");
    const resp = await fetch(`${API_BASE}/api/connections/queue`);
    log("Queue response status:", resp.status);
    if (!resp.ok) return;

    const data = await resp.json();
    log("Queue data:", JSON.stringify(data));
    if (!data.item) {
      clearBadge();
      stopPolling();
      return;
    }

    processing = true;
    currentItem = data.item;
    setBadge("...", "#f59e0b");

    // Extract vanity name from profile URL and use the direct invite page
    const urlObj = new URL(data.item.profile_url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    // URL pattern: /in/<vanityName>
    const vanityName = pathParts[pathParts.length - 1];
    const inviteUrl = `https://www.linkedin.com/preload/custom-invite/?vanityName=${vanityName}`;
    log("Creating tab for invite URL:", inviteUrl, "(original:", data.item.profile_url, ")");
    const tab = await chrome.tabs.create({
      url: inviteUrl,
      active: false,
    });
    currentTabId = tab.id;
    log("Tab created, id:", tab.id);

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === currentTabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        log("Tab loaded, sending SEND_CONNECTION to tab:", tabId);

        chrome.tabs.sendMessage(tabId, {
          type: "SEND_CONNECTION",
          profileId: currentItem.profile_id,
        }).then((response) => {
          log("Content script responded:", JSON.stringify(response));
        }).catch((err) => {
          log("First sendMessage failed:", err.message, "— injecting content script manually");
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"],
          }).then(() => {
            log("Content script injected, retrying sendMessage...");
            chrome.tabs.sendMessage(tabId, {
              type: "SEND_CONNECTION",
              profileId: currentItem.profile_id,
            }).then((response) => {
              log("Retry content script responded:", JSON.stringify(response));
            }).catch((err2) => {
              log("Retry sendMessage also failed:", err2.message);
              reportResult(currentItem.profile_id, "failed", "content_script_unreachable");
              cleanup();
            });
          }).catch((err3) => {
            log("Script injection failed:", err3.message);
            reportResult(currentItem.profile_id, "failed", "content_script_unreachable");
            cleanup();
          });
        });
      }
    });
  } catch (err) {
    log("Poll error:", err.message);
    processing = false;
  }
}

function cleanup(keepTab = false) {
  log("cleanup called, closing tab:", currentTabId, "keepTab:", keepTab);
  if (currentTabId && !keepTab) {
    chrome.tabs.remove(currentTabId).catch(() => {});
  }
  currentTabId = null;
  currentItem = null;
  processing = false;
}

async function reportResult(profileId, status, error) {
  log("reportResult:", profileId, status, error);
  try {
    await fetch(`${API_BASE}/api/connections/${profileId}/result`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status, error: error || null }),
    });
  } catch (err) {
    log("Report error:", err.message);
  }
}

async function saveEnrichment(profileId, data) {
  try {
    await fetch(`${API_BASE}/api/profiles/${profileId}/enrichment`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    log("Enrichment saved for profile:", profileId);
  } catch (err) {
    log("Failed to save enrichment:", err.message);
  }
}

async function processEnrichQueue() {
  if (enrichProcessing || enrichPaused || enrichQueue.length === 0) return;
  if (enrichSessionCount >= ENRICH_SESSION_LIMIT) {
    log("Enrichment session limit reached:", enrichSessionCount);
    return;
  }

  enrichProcessing = true;
  const item = enrichQueue.shift();
  enrichSessionCount++;
  log("Processing enrichment for:", item.profileId, item.profileUrl);

  try {
    const tab = await chrome.tabs.create({ url: item.profileUrl, active: false });
    enrichCurrentTabId = tab.id;

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === enrichCurrentTabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        log("Enrichment tab loaded, sending SCRAPE_PROFILE to tab:", tabId);

        chrome.tabs.sendMessage(tabId, {
          type: "SCRAPE_PROFILE",
          profileId: item.profileId,
        }).catch((err) => {
          log("Enrichment sendMessage failed, injecting script:", err.message);
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["enrichment-content.js"],
          }).then(() => {
            chrome.tabs.sendMessage(tabId, {
              type: "SCRAPE_PROFILE",
              profileId: item.profileId,
            }).catch((err2) => {
              log("Enrichment retry failed:", err2.message);
              if (enrichCurrentTabId) chrome.tabs.remove(enrichCurrentTabId).catch(() => {});
              enrichCurrentTabId = null;
              enrichProcessing = false;
              setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
            });
          }).catch((err3) => {
            log("Enrichment script injection failed:", err3.message);
            if (enrichCurrentTabId) chrome.tabs.remove(enrichCurrentTabId).catch(() => {});
            enrichCurrentTabId = null;
            enrichProcessing = false;
            setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
          });
        });
      }
    });

    setTimeout(() => {
      if (enrichProcessing && enrichCurrentTabId === tab.id) {
        log("Enrichment timeout for profile:", item.profileId);
        chrome.tabs.remove(tab.id).catch(() => {});
        enrichCurrentTabId = null;
        enrichProcessing = false;
        setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
      }
    }, 15000);
  } catch (err) {
    log("Enrich tab creation failed:", err.message);
    enrichProcessing = false;
    setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("Received message:", JSON.stringify(message));

  if (message.type === "CONNECTION_RESULT") {
    const profileId = currentItem?.profile_id;
    if (!profileId) {
      log("No currentItem, ignoring result");
      return;
    }

    reportResult(profileId, message.status, message.error).then(() => {
      const keepTab = message.status !== "sent";
      cleanup(keepTab);

      if (message.status === "sent") {
        setBadge("OK", "#22c55e");
        setTimeout(clearBadge, 3000);
      } else if (message.error === "captcha") {
        setBadge("!", "#ef4444");
        paused = true;
        setTimeout(() => {
          paused = false;
          clearBadge();
        }, PAUSE_DURATION);
      } else {
        setBadge("X", "#ef4444");
        setTimeout(clearBadge, 3000);
      }
    });

    sendResponse({ received: true });
  }

  if (message.type === "ENRICH_PROFILE") {
    log("Enrich request for profile:", message.profileId);
    const alreadyQueued = enrichQueue.some((q) => q.profileId === message.profileId);
    if (!alreadyQueued) {
      enrichQueue.push({ profileId: message.profileId, profileUrl: message.profileUrl });
      processEnrichQueue();
    }
    sendResponse({ received: true });
  }

  if (message.type === "START_POLLING") {
    log("START_POLLING message received");
    startPolling();
    sendResponse({ started: true });
  }

  if (message.type === "TRIGGER_SYNC") {
    log("Manual TRIGGER_SYNC received");
    startPostScanSync();
    sendResponse({ started: true });
  }

  if (message.type === "SYNC_PROGRESS") {
    log("Sync progress:", message.source, "scraped:", message.scraped, "batch:", message.batch, "waiting:", message.waiting);
    chrome.tabs.query({ url: "http://localhost:3000/*" }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
    sendResponse({ received: true });
  }

  if (message.type === "TRIGGER_POST_SCAN_SYNC") {
    log("Post-scan sync requested");
    startPostScanSync();
    sendResponse({ started: true });
  }

  if (message.type === "SYNC_CONNECTIONS_RESULT") {
    log("Connections sync result — slugs:", message.connectedSlugs?.length);
    postScanSyncState.connectedSlugs = message.connectedSlugs || [];
    if (sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
      postScanSyncState.connectedTabId = null;
    }
    maybeFinishPostScanSync();
    sendResponse({ received: true });
  }

  if (message.type === "SYNC_SENT_RESULT") {
    const scraped = message.pendingSlugs?.length || 0;
    const expected = message.totalExpected || 0;
    log("Sync sent result — scraped:", scraped, "expected:", expected);

    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id).catch(() => {});

    if (postScanSyncState.active) {
      postScanSyncState.sentSlugs = message.pendingSlugs || [];
      postScanSyncState.sentTabId = null;
      syncInProgress = false;
      openConnectionsTab();
      sendResponse({ received: true });
      return;
    }

    log("Sent scrape complete — new slugs saved to DB by content script");
    syncInProgress = false;
    sendResponse({ received: true });
  }

  if (message.type === "ENRICHMENT_RESULT") {
    log("Enrichment scraped data for profile:", message.profileId, JSON.stringify(message.data));
    saveEnrichment(message.profileId, message.data).then(() => {
      if (enrichCurrentTabId) {
        chrome.tabs.remove(enrichCurrentTabId).catch(() => {});
        enrichCurrentTabId = null;
      }
      enrichProcessing = false;
      setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
    });
    sendResponse({ received: true });
  }

  if (message.type === "API_FETCH") {
    const { url, method, body } = message;
    fetch(url, {
      method: method || "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
      .then((resp) => resp.ok ? resp.json() : Promise.reject(new Error("HTTP " + resp.status)))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId && processing) {
    log("Tab closed manually:", tabId);
    const profileId = currentItem?.profile_id;
    if (profileId) {
      reportResult(profileId, "failed", "tab_closed_manually");
    }
    cleanup();
    setBadge("X", "#ef4444");
    setTimeout(clearBadge, 3000);
  }
  if (tabId === enrichCurrentTabId && enrichProcessing) {
    log("Enrichment tab closed manually:", tabId);
    enrichCurrentTabId = null;
    enrichProcessing = false;
    setTimeout(processEnrichQueue, ENRICH_INTERVAL_MS);
  }
});

function startPolling() {
  chrome.alarms.get("pollQueue", (alarm) => {
    if (!alarm) {
      log("Starting poll alarm");
      chrome.alarms.create("pollQueue", { periodInMinutes: 0.1667 });
      pollQueue();
    }
  });
}

function stopPolling() {
  log("Stopping poll alarm — queue empty");
  chrome.alarms.clear("pollQueue");
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "pollQueue") {
    pollQueue();
  }
});

async function checkAndStartPolling() {
  try {
    const resp = await fetch(`${API_BASE}/api/connections/queue`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.item) {
        log("Found queued items, starting polling");
        startPolling();
      }
    }
  } catch (err) {
    // server not up yet
  }
}

chrome.runtime.onInstalled.addListener(() => {
  log("Extension installed/updated — checking queue");
  checkAndStartPolling();
});
chrome.runtime.onStartup.addListener(() => {
  log("Extension startup — checking queue");
  checkAndStartPolling();
});

async function syncSentConnections() {
  if (syncInProgress) return;
  syncInProgress = true;
  log("Starting sent-connections sync...");

  try {
    const tab = await chrome.tabs.create({
      url: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
      active: true,
    });
    const syncTabId = tab.id;

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === syncTabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        log("Sync tab loaded, sending SYNC_SENT_PAGE");

        chrome.tabs.sendMessage(syncTabId, { type: "SYNC_SENT_PAGE" })
          .catch((err) => {
            log("Sync sendMessage failed, injecting script:", err.message);
            chrome.scripting.executeScript({
              target: { tabId: syncTabId },
              files: ["sync-sent-content.js"],
            }).then(() => {
              chrome.tabs.sendMessage(syncTabId, { type: "SYNC_SENT_PAGE" })
                .catch((err2) => {
                  log("Sync retry failed:", err2.message);
                  chrome.tabs.remove(syncTabId).catch(() => {});
                  syncInProgress = false;
                });
            }).catch((err3) => {
              log("Sync script injection failed:", err3.message);
              chrome.tabs.remove(syncTabId).catch(() => {});
              syncInProgress = false;
            });
          });

        setTimeout(() => {
          if (syncInProgress) {
            log("Sync timeout, closing tab");
            chrome.tabs.remove(syncTabId).catch(() => {});
            syncInProgress = false;
          }
        }, 300000);
      }
    });
  } catch (err) {
    log("Sync tab creation failed:", err.message);
    syncInProgress = false;
  }
}

async function startPostScanSync() {
  if (postScanSyncState.active) {
    log("Post-scan sync already active");
    return;
  }
  postScanSyncState = {
    active: true,
    sentSlugs: null,
    connectedSlugs: null,
    sentTabId: null,
    connectedTabId: null,
  };
  log("Starting post-scan sync — opening sent tab first...");

  try {
    const sentTab = await chrome.tabs.create({
      url: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
      active: true,
    });
    postScanSyncState.sentTabId = sentTab.id;

    chrome.tabs.onUpdated.addListener(function sentListener(tabId, info) {
      if (tabId === postScanSyncState.sentTabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(sentListener);
        log("Post-scan: sent tab loaded");
        chrome.tabs.sendMessage(tabId, { type: "SYNC_SENT_PAGE" })
          .catch(() => {
            chrome.scripting.executeScript({ target: { tabId }, files: ["sync-sent-content.js"] })
              .then(() => chrome.tabs.sendMessage(tabId, { type: "SYNC_SENT_PAGE" }))
              .catch((err) => {
                log("Post-scan: sent tab script failed:", err.message);
                postScanSyncState.sentSlugs = [];
                openConnectionsTab();
              });
          });
      }
    });

    setTimeout(() => {
      if (postScanSyncState.active && postScanSyncState.sentSlugs === null && postScanSyncState.connectedSlugs === null) {
        log("Post-scan sync timeout");
        if (postScanSyncState.sentTabId) chrome.tabs.remove(postScanSyncState.sentTabId).catch(() => {});
        if (postScanSyncState.connectedTabId) chrome.tabs.remove(postScanSyncState.connectedTabId).catch(() => {});
        postScanSyncState.sentSlugs = postScanSyncState.sentSlugs || [];
        postScanSyncState.connectedSlugs = postScanSyncState.connectedSlugs || [];
        maybeFinishPostScanSync();
      }
    }, 600000);
  } catch (err) {
    log("Post-scan sync tab creation failed:", err.message);
    postScanSyncState.active = false;
    notifyDashboardSyncDone(0, 0);
  }
}

async function openConnectionsTab() {
  log("Post-scan: opening connections tab...");
  try {
    const connTab = await chrome.tabs.create({
      url: "https://www.linkedin.com/mynetwork/invite-connect/connections/",
      active: true,
    });
    postScanSyncState.connectedTabId = connTab.id;
    if (connTab.windowId) {
      chrome.windows.update(connTab.windowId, { focused: true });
    }

    chrome.tabs.onUpdated.addListener(function connListener(tabId, info) {
      if (tabId === postScanSyncState.connectedTabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(connListener);
        log("Post-scan: connections tab loaded");
        chrome.tabs.sendMessage(tabId, { type: "SYNC_CONNECTIONS_PAGE" })
          .catch(() => {
            chrome.scripting.executeScript({ target: { tabId }, files: ["sync-connections-content.js"] })
              .then(() => chrome.tabs.sendMessage(tabId, { type: "SYNC_CONNECTIONS_PAGE" }))
              .catch((err) => {
                log("Post-scan: connections tab script failed:", err.message);
                postScanSyncState.connectedSlugs = [];
                maybeFinishPostScanSync();
              });
          });
      }
    });
  } catch (err) {
    log("Post-scan: connections tab creation failed:", err.message);
    postScanSyncState.connectedSlugs = [];
    maybeFinishPostScanSync();
  }
}

function maybeFinishPostScanSync() {
  if (postScanSyncState.sentSlugs === null || postScanSyncState.connectedSlugs === null) return;

  log("Post-scan: both scrapers done. Now syncing profiles from cache...");

  fetch(`${API_BASE}/api/connections/sync-from-cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
    .then((resp) => resp.json())
    .then((data) => {
      log("Post-scan sync-from-cache response:", JSON.stringify(data));
      notifyDashboardSyncDone(data.moved_to_sent || 0, data.moved_to_connected || 0, data.promoted_to_connected || 0);
    })
    .catch((err) => {
      log("Post-scan sync-from-cache error:", err.message);
      notifyDashboardSyncDone(0, 0, 0);
    })
    .finally(() => {
      postScanSyncState.active = false;
    });
}

function notifyDashboardSyncDone(movedToSent, movedToConnected, promotedToConnected) {
  chrome.tabs.query({ url: "http://localhost:3000/*" }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: "POST_SCAN_SYNC_DONE",
        movedToSent: movedToSent,
        movedToConnected: movedToConnected,
        promotedToConnected: promotedToConnected,
      }).catch(() => {});
    }
  });
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "START_POLLING") {
    log("External START_POLLING received from:", sender.origin);
    startPolling();
    sendResponse({ started: true });
  }
});
