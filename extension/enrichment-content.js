(function () {
  console.log("[XRay Enrich] Content script loaded on:", window.location.href);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getName() {
    const section = document.querySelector("#person-medium")?.closest("section");
    if (section) {
      const h2 = section.querySelector("h2");
      if (h2) return h2.textContent?.trim() || null;
    }
    const a = document.querySelector('a[href*="/in/"]');
    if (a) {
      const text = a.textContent?.trim() || "";
      const parts = text.split(/(?=[A-Z][a-z])/);
      if (parts.length >= 2) {
        return parts.slice(0, 2).join("").trim();
      }
    }
    return null;
  }

  function getFollowers() {
    const text = document.body.textContent || "";
    const match = text.match(/([\d,]+)\s*followers/i);
    return match ? match[1] : null;
  }

  function getLocation() {
    const section = document.querySelector("#person-medium")?.closest("section");
    if (!section) return null;
    const text = section.textContent || "";
    // Location appears before "Contact info"
    const match = text.match(/([A-Z][^·\n]{3,50}(?:Area|Region|City|State|Country|India|USA|UK|Canada|Australia|Germany|France|Singapore|Dubai|Netherlands|Ireland|Israel|Japan|Brazil))[^a-z]*(?:·\s*Contact|Contact)/i);
    if (match) return match[1].trim();
    // Fallback: text between last org and "Contact info"
    const contactMatch = text.match(/([A-Z][A-Za-z\s,.-]{3,50})\s*·?\s*Contact info/);
    if (contactMatch) {
      const loc = contactMatch[1].trim();
      if (loc.length > 3 && loc.length < 60 && !loc.includes("Follow") && !loc.includes("Connect")) {
        return loc;
      }
    }
    return null;
  }

  function getAbout() {
    const section = document.querySelector("#skills-medium")?.closest("section");
    if (!section) return null;
    const text = section.textContent?.trim() || "";
    const cleaned = text.replace(/^About\s*/i, "").trim();
    return cleaned.length > 10 ? cleaned.slice(0, 500) : null;
  }

  function getExperience() {
    // Experience section may use different IDs or be lazy-loaded
    const sections = document.querySelectorAll("section");
    for (const section of sections) {
      const header = section.querySelector("h2, h3");
      if (header && /experience/i.test(header.textContent || "")) {
        const items = section.querySelectorAll('[aria-hidden="true"]');
        if (items.length > 0) return items[0].textContent?.trim() || null;
        const spans = section.querySelectorAll("span");
        for (const span of spans) {
          const t = span.textContent?.trim() || "";
          if (t.length > 5 && t.length < 100 && !t.includes("Experience")) return t;
        }
      }
    }
    return null;
  }

  function getEducation() {
    const sections = document.querySelectorAll("section");
    for (const section of sections) {
      const header = section.querySelector("h2, h3");
      if (header && /education/i.test(header.textContent || "")) {
        const items = section.querySelectorAll('[aria-hidden="true"]');
        if (items.length > 0) return items[0].textContent?.trim() || null;
        const spans = section.querySelectorAll("span");
        for (const span of spans) {
          const t = span.textContent?.trim() || "";
          if (t.length > 5 && t.length < 100 && !t.includes("Education")) return t;
        }
      }
    }
    return null;
  }

  function getLastPostDate() {
    const text = document.body.textContent || "";
    const relMatch = text.match(/(\d+)\s*(day|week|month|year|hour|minute)s?\s*ago/i);
    if (relMatch) {
      return estimateDate(`${relMatch[1]}${relMatch[2][0]}`);
    }
    const shortMatch = text.match(/(\d{1,2}[dwmyh])\b/);
    if (shortMatch) return estimateDate(shortMatch[1]);
    return null;
  }

  function estimateDate(shorthand) {
    const now = new Date();
    const num = parseInt(shorthand);
    const unit = shorthand.replace(/\d+/, "").toLowerCase();
    switch (unit) {
      case "h": now.setHours(now.getHours() - num); break;
      case "d": now.setDate(now.getDate() - num); break;
      case "w": now.setDate(now.getDate() - num * 7); break;
      case "m": now.setMonth(now.getMonth() - num); break;
      case "y": now.setFullYear(now.getFullYear() - num); break;
    }
    return now.toISOString().split("T")[0];
  }

  async function scrapeProfile() {
    await sleep(3000);

    // Scroll down to trigger lazy-loading of Experience/Education sections
    window.scrollTo(0, document.body.scrollHeight / 2);
    await sleep(2000);
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(2000);

    const data = {
      name: getName(),
      followers: getFollowers(),
      location: getLocation(),
      experience: getExperience(),
      education: getEducation(),
      last_post_date: getLastPostDate(),
      about: getAbout(),
    };

    console.log("[XRay Enrich] Scraped data:", JSON.stringify(data));
    return data;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SCRAPE_PROFILE") {
      console.log("[XRay Enrich] Received SCRAPE_PROFILE for profileId:", message.profileId);
      scrapeProfile().then((data) => {
        chrome.runtime.sendMessage({
          type: "ENRICHMENT_RESULT",
          profileId: message.profileId,
          data: data,
        });
      });
      sendResponse({ received: true });
    }
  });
})();
