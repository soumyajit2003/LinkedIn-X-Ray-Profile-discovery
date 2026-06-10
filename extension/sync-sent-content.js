(function () {
  const API_BASE = "http://localhost:8000";

  console.log("[XRay Sync] Content script loaded on:", window.location.href);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function apiFetch(url, method, body) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "API_FETCH", url, method, body }, (resp) => {
        resolve(resp);
      });
    });
  }

  function scrapeVanitySlugs() {
    const slugs = [];
    const main = document.querySelector("main");
    if (!main) return slugs;
    const links = main.querySelectorAll('a[href*="/in/"]');
    const seen = new Set();
    for (const link of links) {
      const href = link.getAttribute("href") || link.href || "";
      const match = href.match(/\/in\/([^/?#]+)/);
      if (match) {
        const slug = match[1].toLowerCase();
        if (!seen.has(slug)) {
          seen.add(slug);
          slugs.push(slug);
        }
      }
    }
    return slugs;
  }

  function clickLoadMore() {
    const main = document.querySelector("main");
    if (!main) return false;
    const btns = main.querySelectorAll("button");
    for (const btn of btns) {
      const text = (btn.textContent || "").trim().toLowerCase();
      if (text === "load more") {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function scrollToBottom() {
    const main = document.querySelector("main");
    if (main) {
      main.scrollTop = main.scrollHeight;
    }
  }

  async function fetchKnownSlugs() {
    const resp = await apiFetch(`${API_BASE}/api/connections/known-sent-slugs`);
    if (resp && resp.ok) {
      return new Set(resp.data.slugs);
    }
    console.log("[XRay Sync] Failed to fetch known slugs:", resp?.error);
    return null;
  }

  async function saveBatch(slugs) {
    const resp = await apiFetch(`${API_BASE}/api/connections/sent-slugs`, "POST", { slugs });
    if (resp && resp.ok) {
      console.log("[XRay Sync] Saved batch of", slugs.length, "sent slugs");
    } else {
      console.log("[XRay Sync] Failed to save batch:", resp?.error);
    }
  }

  async function doSync() {
    await sleep(3000);

    const knownSlugs = await fetchKnownSlugs();
    if (knownSlugs === null) {
      console.log("[XRay Sync] Backend unreachable — aborting sync");
      chrome.runtime.sendMessage({ type: "SYNC_SENT_RESULT", pendingSlugs: [], totalExpected: 0, newCount: 0 });
      return;
    }
    console.log("[XRay Sync] Known sent slugs in DB:", knownSlugs.size);

    let previousCount = 0;
    let staleRounds = 0;
    const MAX_STALE_ROUNDS = 15;
    let newSlugs = [];
    let hitKnown = false;

    while (true) {
      scrollToBottom();
      await sleep(1500);
      clickLoadMore();
      await sleep(2000);

      const allSlugs = scrapeVanitySlugs();
      const currentCount = allSlugs.length;

      if (currentCount !== previousCount) {
        console.log("[XRay Sync] Scraped so far:", currentCount);

        const newBatch = allSlugs.slice(previousCount);
        for (const slug of newBatch) {
          if (knownSlugs.has(slug)) {
            hitKnown = true;
            for (const s of allSlugs) {
              if (knownSlugs.has(s)) break;
              if (!newSlugs.includes(s)) newSlugs.push(s);
            }
            break;
          }
        }

        if (hitKnown) {
          console.log("[XRay Sync] Hit known slug, stopping. New slugs:", newSlugs.length);
          break;
        }
      }

      if (currentCount === previousCount) {
        staleRounds++;
        if (staleRounds >= MAX_STALE_ROUNDS) {
          console.log("[XRay Sync] No new profiles after", MAX_STALE_ROUNDS, "scrolls, stopping at", currentCount);
          break;
        }
      } else {
        staleRounds = 0;
      }

      previousCount = currentCount;
    }

    if (!hitKnown) {
      newSlugs = scrapeVanitySlugs().filter((s) => !knownSlugs.has(s));
    }

    if (newSlugs.length > 0) {
      await saveBatch(newSlugs);
      chrome.runtime.sendMessage({
        type: "SYNC_PROGRESS",
        source: "sent",
        scraped: newSlugs.length,
      });
    }

    const allScraped = scrapeVanitySlugs();
    console.log("[XRay Sync] Final: new slugs saved:", newSlugs.length, "total on page:", allScraped.length);

    chrome.runtime.sendMessage({
      type: "SYNC_SENT_RESULT",
      pendingSlugs: allScraped,
      totalExpected: allScraped.length,
      newCount: newSlugs.length,
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SYNC_SENT_PAGE") {
      console.log("[XRay Sync] Received SYNC_SENT_PAGE");
      doSync();
      sendResponse({ received: true });
    }
  });
})();
