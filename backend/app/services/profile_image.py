import logging
import re

import httpx

logger = logging.getLogger(__name__)

SERPER_SEARCH_URL = "https://google.serper.dev/search"
SERPER_IMAGES_URL = "https://google.serper.dev/images"

LOCATION_PATTERN = re.compile(
    r"([A-Z][A-Za-z\s]+(?:Area|Region|City|County|District|Province|State)"
    r"|[A-Z][A-Za-z\s]+,\s*[A-Z][A-Za-z\s]+)",
)


def _extract_slug(profile_url: str) -> str:
    match = re.search(r"/in/([^/?#]+)", profile_url)
    return match.group(1).lower() if match else ""


def _name_matches(db_name: str, result_title: str) -> bool:
    if not db_name or not result_title:
        return False
    db_parts = db_name.lower().split()
    title_lower = result_title.lower()
    # At least first or last name must appear in the title
    for part in db_parts:
        if len(part) > 2 and part in title_lower:
            return True
    return False


def _extract_location_from_snippet(snippet: str) -> str | None:
    if not snippet:
        return None
    match = LOCATION_PATTERN.search(snippet)
    if match:
        loc = match.group(0).strip()
        if len(loc) > 3 and len(loc) < 60:
            return loc
    # Fallback: look for "City, Country" or "City, State" pattern with known separators
    parts = snippet.split(" · ")
    for part in parts:
        part = part.strip()
        if "," in part and len(part) < 60 and len(part) > 3:
            # Likely a location like "San Francisco, California"
            if not any(kw in part.lower() for kw in ["http", "view", "linkedin", "profile", "connection"]):
                return part
    return None


def _clean_snippet(snippet: str) -> str | None:
    if not snippet:
        return None
    # Remove common LinkedIn boilerplate
    boilerplate = [
        "View ", "Learn more about ", "See ", "Join LinkedIn",
        "Sign up", "Log in", "professional profile on LinkedIn",
    ]
    for bp in boilerplate:
        if snippet.lower().startswith(bp.lower()):
            return None
    cleaned = snippet.strip()
    if len(cleaned) < 10:
        return None
    return cleaned[:500]


async def fetch_profile_info_via_serper(
    profiles: list[dict], api_key: str, client: httpx.AsyncClient
) -> list[dict]:
    """Fetch profile info via Serper Search API.
    For each profile, searches Google and extracts: thumbnail, snippet, location.
    Returns list of dicts with profile_url and extracted fields.
    Uses 1 API credit per profile."""
    results = []

    for profile in profiles:
        name = profile["name"]
        profile_url = profile["profile_url"]
        slug = _extract_slug(profile_url)

        if not slug:
            continue

        payload = {
            "q": f"{name} site:linkedin.com/in/{slug}",
            "num": 3,
        }
        headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}

        try:
            resp = await client.post(SERPER_SEARCH_URL, json=payload, headers=headers, timeout=10.0)
            if resp.status_code != 200:
                logger.debug(f"Serper search returned {resp.status_code} for {name}")
                continue

            data = resp.json()
            organic = data.get("organic", [])

            for result in organic:
                result_link = result.get("link", "")
                result_slug = _extract_slug(result_link)

                # Check 1: Vanity slug must match
                if result_slug != slug:
                    continue

                # Check 2: Name similarity
                result_title = result.get("title", "")
                if not _name_matches(name, result_title):
                    continue

                # Passed both checks — extract data
                snippet = result.get("snippet", "")
                thumbnail = result.get("thumbnail", "")

                extracted = {"profile_url": profile_url}

                # Extract location from snippet
                location = _extract_location_from_snippet(snippet)
                if location:
                    extracted["location"] = location

                # Clean and save snippet (headline/bio)
                clean = _clean_snippet(snippet)
                if clean:
                    extracted["snippet"] = clean

                # Thumbnail from search result
                if thumbnail and ("licdn.com" in thumbnail or "googleusercontent" in thumbnail):
                    extracted["thumbnail_url"] = thumbnail

                results.append(extracted)
                break

        except (httpx.TimeoutException, httpx.HTTPError) as e:
            logger.debug(f"Error searching for {name}: {e}")
        except Exception as e:
            logger.debug(f"Unexpected error for {name}: {e}")

    return results


async def fetch_profile_images_via_serper(
    profiles: list[dict], api_key: str, client: httpx.AsyncClient
) -> dict[str, str]:
    """Fetch LinkedIn profile photos via Serper images API.
    Returns dict of profile_url -> image_url.
    Uses one API call per profile."""
    results = {}

    for profile in profiles:
        name = profile["name"]
        profile_url = profile["profile_url"]
        vanity = profile_url.rstrip("/").split("/in/")[-1] if "/in/" in profile_url else ""

        payload = {
            "q": f"{name} LinkedIn profile photo",
            "num": 5,
        }
        headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}

        try:
            resp = await client.post(SERPER_IMAGES_URL, json=payload, headers=headers, timeout=10.0)
            if resp.status_code != 200:
                logger.debug(f"Serper images API returned {resp.status_code} for {name}")
                continue

            data = resp.json()
            images = data.get("images", [])

            for img in images:
                img_link = img.get("link", "")
                img_url = img.get("imageUrl", "")

                if vanity and vanity in img_link and "profile-displayphoto" in img_url:
                    results[profile_url] = img_url
                    break
                if "linkedin.com/in/" in img_link and "profile-displayphoto" in img_url:
                    if img_link.rstrip("/").endswith(vanity):
                        results[profile_url] = img_url
                        break

        except (httpx.TimeoutException, httpx.HTTPError) as e:
            logger.debug(f"Error fetching image for {name}: {e}")
        except Exception as e:
            logger.debug(f"Unexpected error fetching image for {name}: {e}")

    return results
