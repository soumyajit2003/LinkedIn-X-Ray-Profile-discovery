(function () {
  const API_BASE = "http://localhost:8000";
  const BATCH_SIZE = 300;
  const DELAY_MIN = 60000;
  const DELAY_MAX = 90000;

  console.log("[XRay ConnSync] Content script loaded on:", window.location.href);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDelay() {
    return Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
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
      if (text === "load more" || text === "show more results" || text === "show more") {
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
      main.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

  async function fetchKnownSlugs() {
    const resp = await apiFetch(`${API_BASE}/api/connections/known-connected-slugs`);
    if (resp && resp.ok) {
      return new Set(resp.data.slugs);
    }
    console.log("[XRay ConnSync] Failed to fetch known slugs:", resp?.error);
    return null;
  }

  async function saveBatch(slugs) {
    const resp = await apiFetch(`${API_BASE}/api/connections/connected-slugs`, "POST", { slugs });
    if (resp && resp.ok) {
      console.log("[XRay ConnSync] Saved batch of", slugs.length, "connected slugs");
    } else {
      console.log("[XRay ConnSync] Failed to save batch:", resp?.error);
    }
  }

  function getTotalFromHeader() {
    const main = document.querySelector("main");
    if (!main) return null;
    const headings = main.querySelectorAll("h1, h2, span");
    for (const el of headings) {
      const text = el.textContent || "";
      const match = text.match(/(\d[\d,]+)\s*(connection|result)/i);
      if (match) {
        return parseInt(match[1].replace(/,/g, ""), 10);
      }
    }
    return null;
  }

  async function doSync() {
    await sleep(5000);
    window.focus();
    document.querySelector("main")?.click();

    const knownSlugs = await fetchKnownSlugs();
    if (knownSlugs === null) {
      console.log("[XRay ConnSync] Backend unreachable — aborting sync");
      chrome.runtime.sendMessage({ type: "SYNC_CONNECTIONS_RESULT", connectedSlugs: [], totalNew: 0 });
      return;
    }
    console.log("[XRay ConnSync] Known connected slugs in DB:", knownSlugs.size);

    const totalOnPage = getTotalFromHeader();
    console.log("[XRay ConnSync] Total connections on page header:", totalOnPage);

    // If DB already has >= page total, no scraping needed
    if (totalOnPage && knownSlugs.size >= totalOnPage) {
      console.log("[XRay ConnSync] DB already has all connections, skipping scrape");
      chrome.runtime.sendMessage({ type: "SYNC_CONNECTIONS_RESULT", connectedSlugs: [], totalNew: 0 });
      return;
    }

    chrome.runtime.sendMessage({
      type: "SYNC_PROGRESS",
      source: "connections",
      scraped: 0,
      batch: 0,
    });

    // Quick check: see if the first visible profiles are already known (no scroll needed)
    await sleep(3000);
    const initialSlugs = scrapeVanitySlugs();
    if (initialSlugs.length > 0 && knownSlugs.has(initialSlugs[0])) {
      console.log("[XRay ConnSync] Top profile already known (" + initialSlugs[0] + ") — no new connections, skipping");
      chrome.runtime.sendMessage({ type: "SYNC_CONNECTIONS_RESULT", connectedSlugs: [], totalNew: 0 });
      return;
    }

    let allNewSlugs = [];
    let batchNum = 0;
    let lastCheckedIndex = 0;
    let hitKnown = false;

    while (true) {
      batchNum++;
      const targetCount = batchNum * BATCH_SIZE;
      console.log("[XRay ConnSync] Scrolling batch", batchNum, "- target:", targetCount);

      let staleRounds = 0;
      const MAX_STALE = 25;
      let lastCount = scrapeVanitySlugs().length;

      while (scrapeVanitySlugs().length < targetCount) {
        scrollToBottom();
        await sleep(2000);
        clickLoadMore();
        await sleep(3000);

        const currentSlugs = scrapeVanitySlugs();
        const currentCount = currentSlugs.length;

        // Check new slugs as they appear — stop early if we hit a known one
        for (let i = lastCheckedIndex; i < currentCount; i++) {
          if (knownSlugs.has(currentSlugs[i])) {
            hitKnown = true;
            // Save everything before this known slug
            const newOnes = currentSlugs.slice(lastCheckedIndex, i).filter(s => !knownSlugs.has(s));
            if (newOnes.length > 0) {
              allNewSlugs = allNewSlugs.concat(newOnes);
              await saveBatch(newOnes);
            }
            lastCheckedIndex = currentCount;
            break;
          }
        }
        if (hitKnown) break;

        if (currentCount !== lastCount) {
          console.log("[XRay ConnSync] Scroll round — count:", currentCount);
        }
        if (currentCount === lastCount) {
          staleRounds++;
          if (staleRounds >= MAX_STALE) {
            console.log("[XRay ConnSync] Stale limit reached at count:", currentCount);
            break;
          }
        } else {
          staleRounds = 0;
          lastCount = currentCount;
        }
      }

      if (hitKnown) {
        console.log("[XRay ConnSync] Hit known slug in batch", batchNum, "- stopping");
        break;
      }

      const currentSlugs = scrapeVanitySlugs();
      const batchSlugs = currentSlugs.slice(lastCheckedIndex);

      const newInBatch = [];
      for (const slug of batchSlugs) {
        if (knownSlugs.has(slug)) {
          hitKnown = true;
          break;
        }
        newInBatch.push(slug);
      }

      if (newInBatch.length > 0) {
        allNewSlugs = allNewSlugs.concat(newInBatch);
        await saveBatch(newInBatch);
        chrome.runtime.sendMessage({
          type: "SYNC_PROGRESS",
          source: "connections",
          scraped: allNewSlugs.length,
          batch: batchNum,
        });
      }

      lastCheckedIndex = currentSlugs.length;

      if (hitKnown) {
        console.log("[XRay ConnSync] Hit known slug in batch", batchNum, "- stopping");
        break;
      }

      if (totalOnPage && allNewSlugs.length + knownSlugs.size >= totalOnPage) {
        console.log("[XRay ConnSync] Reached total from header:", totalOnPage, "- stopping");
        break;
      }

      if (batchSlugs.length === 0) {
        console.log("[XRay ConnSync] No new profiles in batch", batchNum, "- page exhausted at", currentSlugs.length);
        break;
      }

      const delay = randomDelay();
      console.log("[XRay ConnSync] Waiting", Math.round(delay / 1000), "seconds before next batch...");
      chrome.runtime.sendMessage({
        type: "SYNC_PROGRESS",
        source: "connections",
        scraped: allNewSlugs.length,
        batch: batchNum,
        waiting: Math.round(delay / 1000),
      });
      await sleep(delay);

      scrollToBottom();
      await sleep(3000);
    }

    console.log("[XRay ConnSync] Done. Total new slugs:", allNewSlugs.length);

    chrome.runtime.sendMessage({
      type: "SYNC_CONNECTIONS_RESULT",
      connectedSlugs: allNewSlugs,
      totalNew: allNewSlugs.length,
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SYNC_CONNECTIONS_PAGE") {
      console.log("[XRay ConnSync] Received SYNC_CONNECTIONS_PAGE");
      doSync();
      sendResponse({ received: true });
    }
  });
})();
