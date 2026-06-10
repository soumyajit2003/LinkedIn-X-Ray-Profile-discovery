import asyncio
import logging
import re

import httpx

logger = logging.getLogger(__name__)

SERPER_API_URL = "https://google.serper.dev/search"

_FOLLOWERS_PATTERN = re.compile(r"(\d+(?:\.\d+)?[KkMm]?\+?)\s+followers", re.IGNORECASE)


def _extract_followers(snippet: str) -> str | None:
    match = _FOLLOWERS_PATTERN.search(snippet)
    return match.group(1) if match else None


def parse_search_results(raw: dict) -> list[dict]:
    items = raw.get("organic", [])
    results = []
    for item in items:
        title = item.get("title", "")
        link = item.get("link", "")
        snippet = item.get("snippet", "")
        thumbnail = item.get("thumbnail", "") or item.get("thumbnailUrl", "") or ""

        if not title or not link:
            continue

        if "linkedin.com/in/" not in link:
            continue

        name = re.sub(r"\s*[\|\-–—]\s*LinkedIn\s*$", "", title).strip()

        result = {
            "name": name,
            "profile_url": link,
            "snippet": snippet,
            "thumbnail_url": thumbnail,
        }
        followers = _extract_followers(snippet)
        if followers:
            result["followers"] = followers

        results.append(result)
    return results


async def fetch_search_page(
    keyword: str,
    api_key: str,
    cx_id: str,
    start: int,
    client: httpx.AsyncClient,
    locations: list[str] | None = None,
) -> dict:
    page = ((start - 1) // 10) + 1
    query = f'site:linkedin.com/in "{keyword}"'
    if locations:
        loc_filter = " OR ".join(f'"{loc}"' for loc in locations)
        query += f" ({loc_filter})"
    payload = {
        "q": query,
        "page": page,
        "num": 10,
    }
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }

    logger.debug(f"Requesting Serper: keyword='{keyword}' page={page}")

    try:
        response = await client.post(SERPER_API_URL, json=payload, headers=headers, timeout=10.0)
    except httpx.TimeoutException:
        logger.warning(f"Timeout fetching page {page} for '{keyword}'")
        raise
    except httpx.HTTPError as e:
        logger.warning(f"HTTP error fetching page {page} for '{keyword}': {e}")
        raise

    if response.status_code == 429 or response.status_code >= 500:
        logger.info(f"Retryable status {response.status_code}, retrying in 2s...")
        await asyncio.sleep(2)
        response = await client.post(SERPER_API_URL, json=payload, headers=headers, timeout=10.0)

    if response.status_code != 200:
        logger.error(f"Serper API error {response.status_code}: {response.text[:200]}")
        raise httpx.HTTPStatusError(
            f"Serper API returned {response.status_code}",
            request=response.request,
            response=response,
        )

    return response.json()
