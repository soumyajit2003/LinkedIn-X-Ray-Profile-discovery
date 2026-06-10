(function () {
  console.log("[XRay Dashboard] Content script loaded on dashboard");

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "ENRICH_PROFILE") {
      console.log("[XRay Dashboard] Forwarding ENRICH_PROFILE to background:", event.data);
      chrome.runtime.sendMessage({
        type: "ENRICH_PROFILE",
        profileId: event.data.profileId,
        profileUrl: event.data.profileUrl,
      });
    }
    if (event.data?.type === "START_POLLING") {
      console.log("[XRay Dashboard] Forwarding START_POLLING to background");
      chrome.runtime.sendMessage({ type: "START_POLLING" });
    }
    if (event.data?.type === "TRIGGER_POST_SCAN_SYNC") {
      console.log("[XRay Dashboard] Forwarding TRIGGER_POST_SCAN_SYNC to background");
      chrome.runtime.sendMessage({ type: "TRIGGER_POST_SCAN_SYNC" });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "POST_SCAN_SYNC_DONE") {
      console.log("[XRay Dashboard] Received POST_SCAN_SYNC_DONE:", message);
      window.postMessage({
        type: "POST_SCAN_SYNC_DONE",
        movedToSent: message.movedToSent,
        movedToConnected: message.movedToConnected,
      }, "*");
      sendResponse({ received: true });
    }
    if (message.type === "SYNC_PROGRESS") {
      window.postMessage({
        type: "SYNC_PROGRESS",
        source: message.source,
        scraped: message.scraped,
        batch: message.batch,
        waiting: message.waiting,
      }, "*");
      sendResponse({ received: true });
    }
  });
})();
