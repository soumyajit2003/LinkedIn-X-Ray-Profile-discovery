(function () {
  const MAX_WAIT = 10000;
  const POLL_MS = 500;

  console.log("[XRay Content] Content script loaded on:", window.location.href);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isCaptchaPage() {
    return (
      document.title.toLowerCase().includes("security verification") ||
      document.querySelector('iframe[src*="captcha"]') !== null ||
      document.querySelector(".challenge-dialog") !== null
    );
  }

  function isRestrictionPage() {
    const body = document.body?.textContent?.toLowerCase() || "";
    return body.includes("you've reached the weekly invitation limit");
  }

  async function waitForElement(finder, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = finder();
      if (el) return el;
      await sleep(POLL_MS);
    }
    return null;
  }

  function findSendWithoutNoteButton() {
    const allButtons = document.querySelectorAll("button");
    for (const btn of allButtons) {
      const text = btn.textContent?.trim().toLowerCase() || "";
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (
        text === "send without a note" ||
        text === "send now" ||
        aria === "send without a note" ||
        aria === "send now"
      ) {
        console.log("[XRay Content] Found button:", btn.textContent?.trim(), "aria:", aria);
        return btn;
      }
    }
    return null;
  }

  function sendResult(status, error) {
    console.log("[XRay Content] Sending result:", status, error);
    chrome.runtime.sendMessage({
      type: "CONNECTION_RESULT",
      status: status,
      error: error || null,
    });
  }

  async function doConnect() {
    console.log("[XRay Content] doConnect() started on invite page, waiting for render...");
    await sleep(2000);

    if (isCaptchaPage()) {
      console.log("[XRay Content] Captcha detected!");
      sendResult("failed", "captcha");
      return;
    }

    if (isRestrictionPage()) {
      console.log("[XRay Content] Restriction page detected!");
      sendResult("failed", "weekly_limit");
      return;
    }

    console.log("[XRay Content] Looking for 'Send without a note' button...");
    const sendBtn = await waitForElement(findSendWithoutNoteButton, MAX_WAIT);

    if (sendBtn) {
      console.log("[XRay Content] Clicking 'Send without a note'...");
      sendBtn.click();
      await sleep(1500);
      sendResult("sent", null);
    } else {
      // Dump all buttons for debugging
      const allBtns = document.querySelectorAll("button");
      const texts = [];
      allBtns.forEach((btn) => {
        const t = btn.textContent?.trim();
        const a = btn.getAttribute("aria-label") || "";
        if (t || a) texts.push({ text: t?.substring(0, 60), aria: a });
      });
      console.log("[XRay Content] Page title:", document.title);
      console.log("[XRay Content] All buttons:", JSON.stringify(texts, null, 2));
      sendResult("failed", "send_button_not_found");
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[XRay Content] Received message:", JSON.stringify(message));
    if (message.type === "SEND_CONNECTION") {
      doConnect();
      sendResponse({ received: true });
    }
  });
})();
