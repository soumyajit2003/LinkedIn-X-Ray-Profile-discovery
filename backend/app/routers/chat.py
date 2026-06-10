import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

from app import database
from app.config import OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, BEDROCK_API_KEY, BEDROCK_REGION, BEDROCK_MODEL

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    provider: str
    include_db_context: bool = False
    include_web_search: bool = False
    web_search_query: str | None = None
    context: str | None = None


class ActionExecuteRequest(BaseModel):
    action: str
    profile_ids: list[int]


class AISettingsResponse(BaseModel):
    openai_key_set: bool
    openai_key_masked: str
    openai_model: str
    anthropic_key_set: bool
    anthropic_key_masked: str
    anthropic_model: str
    gemini_key_set: bool
    gemini_key_masked: str
    gemini_model: str
    bedrock_key_set: bool
    bedrock_key_masked: str
    bedrock_region: str
    bedrock_model: str


class AISettingsUpdate(BaseModel):
    openai_key: str | None = None
    openai_model: str | None = None
    anthropic_key: str | None = None
    anthropic_model: str | None = None
    gemini_key: str | None = None
    gemini_model: str | None = None
    bedrock_key: str | None = None
    bedrock_region: str | None = None
    bedrock_model: str | None = None


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) > 8:
        return key[:4] + "*" * (len(key) - 8) + key[-4:]
    return "****"


async def resolve_openai_key() -> str:
    db_val = await database.get_setting("openai_api_key")
    return db_val.strip() if db_val else OPENAI_API_KEY

async def resolve_anthropic_key() -> str:
    db_val = await database.get_setting("anthropic_api_key")
    return db_val.strip() if db_val else ANTHROPIC_API_KEY

async def resolve_gemini_key() -> str:
    db_val = await database.get_setting("gemini_api_key")
    return db_val.strip() if db_val else GEMINI_API_KEY

async def resolve_bedrock_key() -> str:
    db_val = await database.get_setting("bedrock_api_key")
    return db_val.strip() if db_val else BEDROCK_API_KEY

async def resolve_bedrock_region() -> str:
    db_val = await database.get_setting("bedrock_region")
    return db_val.strip() if db_val else (BEDROCK_REGION or "us-east-1")

async def resolve_bedrock_model() -> str:
    db_val = await database.get_setting("bedrock_model")
    return db_val.strip() if db_val else (BEDROCK_MODEL or "us.anthropic.claude-sonnet-4-6")


@router.get("/settings", response_model=AISettingsResponse)
async def get_ai_settings():
    openai_key = await resolve_openai_key()
    openai_model = await database.get_setting("openai_model") or "gpt-5.4"
    anthropic_key = await resolve_anthropic_key()
    anthropic_model = await database.get_setting("anthropic_model") or "claude-sonnet-4-6"
    gemini_key = await resolve_gemini_key()
    gemini_model = await database.get_setting("gemini_model") or "gemini-3.1-pro-preview"
    bedrock_key = await resolve_bedrock_key()
    bedrock_region = await resolve_bedrock_region()
    bedrock_model = await resolve_bedrock_model()

    return AISettingsResponse(
        openai_key_set=bool(openai_key),
        openai_key_masked=_mask_key(openai_key),
        openai_model=openai_model,
        anthropic_key_set=bool(anthropic_key),
        anthropic_key_masked=_mask_key(anthropic_key),
        anthropic_model=anthropic_model,
        gemini_key_set=bool(gemini_key),
        gemini_key_masked=_mask_key(gemini_key),
        gemini_model=gemini_model,
        bedrock_key_set=bool(bedrock_key),
        bedrock_key_masked=_mask_key(bedrock_key),
        bedrock_region=bedrock_region,
        bedrock_model=bedrock_model,
    )


@router.put("/settings", response_model=AISettingsResponse)
async def update_ai_settings(body: AISettingsUpdate):
    if body.openai_key is not None:
        await database.set_setting("openai_api_key", body.openai_key.strip())
    if body.openai_model is not None:
        await database.set_setting("openai_model", body.openai_model)
    if body.anthropic_key is not None:
        await database.set_setting("anthropic_api_key", body.anthropic_key.strip())
    if body.anthropic_model is not None:
        await database.set_setting("anthropic_model", body.anthropic_model)
    if body.gemini_key is not None:
        await database.set_setting("gemini_api_key", body.gemini_key.strip())
    if body.gemini_model is not None:
        await database.set_setting("gemini_model", body.gemini_model)
    if body.bedrock_key is not None:
        await database.set_setting("bedrock_api_key", body.bedrock_key.strip())
    if body.bedrock_region is not None:
        await database.set_setting("bedrock_region", body.bedrock_region.strip())
    if body.bedrock_model is not None:
        await database.set_setting("bedrock_model", body.bedrock_model)
    return await get_ai_settings()


async def _web_search(query: str, serper_key: str) -> str:
    """Search the web via Serper and return formatted results."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
            json={"q": query, "num": 10},
        )
        if resp.status_code != 200:
            return f"Web search failed (status {resp.status_code})"

        data = resp.json()
        results = []

        if data.get("knowledgeGraph"):
            kg = data["knowledgeGraph"]
            results.append(f"**Knowledge Graph:** {kg.get('title', '')} — {kg.get('type', '')}")
            if kg.get("description"):
                results.append(f"  {kg['description']}")
            if kg.get("attributes"):
                for k, v in kg["attributes"].items():
                    results.append(f"  {k}: {v}")

        for item in data.get("organic", [])[:8]:
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            link = item.get("link", "")
            results.append(f"- [{title}]({link})\n  {snippet}")

        if data.get("peopleAlsoAsk"):
            results.append("\n**People Also Ask:**")
            for paa in data["peopleAlsoAsk"][:3]:
                results.append(f"- Q: {paa.get('question', '')} → {paa.get('snippet', '')}")

        return "\n".join(results) if results else "No results found."


@router.post("/execute-action")
async def execute_action(body: ActionExecuteRequest):
    """Execute an action (like queueing connections) for given profile IDs."""
    if body.action != "queue_connection":
        raise HTTPException(400, f"Unknown action: {body.action}")

    from datetime import datetime, timezone, timedelta
    import random
    import aiosqlite
    from app.config import DATABASE_PATH

    results = []
    last_scheduled = await database.get_last_scheduled_at()
    base_time = datetime.fromisoformat(last_scheduled) if last_scheduled else datetime.now(timezone.utc)

    for pid in body.profile_ids:
        # Check current status before queueing
        async with aiosqlite.connect(DATABASE_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cursor = await conn.execute(
                "SELECT connection_status FROM profiles WHERE id = ?", (pid,)
            )
            row = await cursor.fetchone()

        if not row:
            results.append({"profile_id": pid, "status": "not_found"})
            continue

        current_status = row["connection_status"]
        if current_status in ("queued", "sent", "connected"):
            results.append({"profile_id": pid, "status": f"already_{current_status}"})
            continue

        delay = random.randint(30, 90)
        scheduled_at = base_time + timedelta(seconds=delay)
        base_time = scheduled_at
        success = await database.update_connection_status(pid, "queued", scheduled_at.isoformat())
        if success:
            results.append({"profile_id": pid, "status": "queued", "scheduled_at": scheduled_at.isoformat()})
        else:
            results.append({"profile_id": pid, "status": "error"})

    return {"results": results, "queued_count": sum(1 for r in results if r["status"] == "queued")}


async def _resolve_provider() -> tuple[str, str, str]:
    """Returns (provider, api_key, model) for the first configured provider."""
    openai_key = await resolve_openai_key()
    if openai_key:
        model = await database.get_setting("openai_model") or "gpt-5.4"
        return "openai", openai_key, model

    anthropic_key = await resolve_anthropic_key()
    if anthropic_key:
        model = await database.get_setting("anthropic_model") or "claude-sonnet-4-6"
        return "anthropic", anthropic_key, model

    gemini_key = await resolve_gemini_key()
    if gemini_key:
        model = await database.get_setting("gemini_model") or "gemini-3.1-pro-preview"
        return "gemini", gemini_key, model

    bedrock_key = await resolve_bedrock_key()
    if bedrock_key:
        model = await resolve_bedrock_model()
        return "bedrock", bedrock_key, model

    return "", "", ""


@router.post("")
async def chat(body: ChatRequest):
    provider = body.provider
    bedrock_region = "us-east-1"
    if provider == "auto":
        provider, api_key, model = await _resolve_provider()
        if not provider:
            raise HTTPException(400, "No AI API key configured. Please add an API key in Settings or .env file.")
        if provider == "bedrock":
            bedrock_region = await resolve_bedrock_region()
    else:
        if provider == "openai":
            api_key = await resolve_openai_key()
            model = await database.get_setting("openai_model") or "gpt-5.4"
        elif provider == "anthropic":
            api_key = await resolve_anthropic_key()
            model = await database.get_setting("anthropic_model") or "claude-sonnet-4-6"
        elif provider == "gemini":
            api_key = await resolve_gemini_key()
            model = await database.get_setting("gemini_model") or "gemini-3.1-pro-preview"
        elif provider == "bedrock":
            api_key = await resolve_bedrock_key()
            bedrock_region = await resolve_bedrock_region()
            model = await resolve_bedrock_model()
        else:
            raise HTTPException(400, f"Unknown provider: {provider}")

        if not api_key:
            raise HTTPException(400, f"No API key configured for {provider}. Please add it in Settings or .env file.")

    system_prompt = (
        "You are a professional AI assistant integrated into a LinkedIn X-Ray Search tool. "
        "You help users with their LinkedIn outreach strategy, profile analysis, "
        "connection messaging, and general questions. Keep responses concise and actionable.\n\n"
        "TONE: Professional and direct. Never use emojis. No bullet-point icons like stars or checkmarks. "
        "Use plain text, dashes, or numbered lists only.\n\n"
        "IMPORTANT: You do NOT have access to the user's profile database by default. "
        "If the user asks something that requires looking at their saved profiles (e.g. recommending people, "
        "finding profiles, sending connections, analyzing their data, listing candidates, etc.), "
        "you MUST respond with ONLY this exact line and nothing else:\n"
        "[[REQUEST:DB_ACCESS]]\n"
        "Do NOT answer the question or guess — just output that single line. "
        "For general chat, greetings, tips, or questions that don't need their specific profile data, respond normally.\n\n"
        "KEYWORD SEARCH ACTIONS:\n"
        "When the user describes what they do, what industry they're in, what kind of people they want to find, "
        "or any intent that implies they want to DISCOVER NEW profiles (not look at existing ones), "
        "you should suggest search keywords and offer to scan LinkedIn for them.\n\n"
        "Examples of user intents that should trigger keyword suggestions:\n"
        "- 'I work in fintech and want to find investors'\n"
        "- 'I need to connect with healthcare AI researchers'\n"
        "- 'Find me people in autonomous driving'\n"
        "- 'I'm building a SaaS for dentists, who should I connect with?'\n"
        "- 'I want to find CTO level people in blockchain'\n"
        "- Any description of their work/needs that implies they want to find NEW people on LinkedIn\n\n"
        "When you detect this intent:\n"
        "1. Understand the user's domain/need\n"
        "2. Generate up to 5 highly relevant LinkedIn search keywords (short, specific phrases that would appear in LinkedIn profiles)\n"
        "3. Explain briefly why you chose these keywords\n"
        "4. Include this ACTION BLOCK at the end:\n"
        "[[ACTION:ADD_KEYWORDS]]\n"
        "KEYWORDS: keyword one, keyword two, keyword three\n"
        "[[/ACTION]]\n\n"
        "RULES:\n"
        "- Maximum 5 keywords\n"
        "- Keywords should be specific LinkedIn search terms (e.g. 'Healthcare AI Startup Founder' not 'find doctors')\n"
        "- After keywords are added, if the user confirms or says 'scan', 'search', 'go ahead', 'yes', include:\n"
        "[[ACTION:START_SCAN]]\n"
        "KEYWORDS: keyword one, keyword two, keyword three\n"
        "PAGES: 3\n"
        "[[/ACTION]]\n"
        "- Default to 3 pages unless user specifies otherwise (max 10)\n"
        "- Always explain what you're doing before the action block\n"
    )

    if body.include_db_context:
        profiles = await database.get_all_profiles(limit=500, offset=0)
        profile_count = len(profiles)

        profiles_context = ""
        if profiles:
            profile_summaries = []
            for p in profiles:
                enrichment = await database.get_enrichment(p["id"])
                summary = f"- [ID:{p['id']}] **{p['name']}** | URL: {p['profile_url']} | Connection: {p.get('connection_status', 'none')} | Keywords: {p.get('matched_keywords', '[]')}"
                if p.get("snippet"):
                    summary += f" | Snippet: {p['snippet']}"
                if enrichment:
                    if enrichment.get("followers"):
                        summary += f" | Followers: {enrichment['followers']}"
                    if enrichment.get("location"):
                        summary += f" | Location: {enrichment['location']}"
                    if enrichment.get("experience"):
                        summary += f" | Experience: {enrichment['experience']}"
                    if enrichment.get("education"):
                        summary += f" | Education: {enrichment['education']}"
                    if enrichment.get("about"):
                        summary += f" | About: {enrichment['about']}"
                    if enrichment.get("last_post_date"):
                        summary += f" | Last Post: {enrichment['last_post_date']}"
                profile_summaries.append(summary)
            profiles_context = "\n".join(profile_summaries)

        system_prompt = (
            "You are a professional AI assistant integrated into a LinkedIn X-Ray Search tool. "
            "You have access to the user's full database of LinkedIn profiles they've discovered. "
            "You help users find the best people to connect with, analyze profiles, suggest outreach strategy, "
            "and explain WHY someone is a good connection based on their profile data.\n\n"
            "TONE: Professional and direct. Never use emojis. No bullet-point icons like stars or checkmarks. "
            "Use plain text, dashes, or numbered lists only.\n\n"
            "When recommending connections, always explain:\n"
            "1. Why this person is relevant (based on their keywords, snippet, experience, about section)\n"
            "2. What value the connection could bring\n"
            "3. Any notable details (followers count, activity, location)\n\n"
            "Be specific and reference actual profile data. If the user asks for recommendations, "
            "analyze ALL profiles and rank the best matches for their stated requirement.\n\n"
            "IMPORTANT - CONNECTION ACTIONS:\n"
            "When the user wants to send a connection to someone, you MUST include an ACTION BLOCK. "
            "Users may phrase this in MANY informal ways — ALL of these mean the same thing:\n"
            "- 'send connection to Emre Aktas'\n"
            "- 'Emre Aktas send connection to him'\n"
            "- 'connect with Emre'\n"
            "- 'queue Emre Aktas'\n"
            "- 'add Emre to my network'\n"
            "- 'send invite to emre'\n"
            "- 'emre aktas connect'\n"
            "- 'send top 5 people connections'\n"
            "- Any variation that implies the user wants to connect with one or more people\n\n"
            "When you detect this intent, find the matching profile(s) by name in the database and "
            "include an ACTION BLOCK at the end of your response in this exact format:\n"
            "```\n"
            "[[ACTION:QUEUE_CONNECTION]]\n"
            "IDS: 42, 17, 85, 103\n"
            "[[/ACTION]]\n"
            "```\n"
            "RULES FOR ACTION BLOCKS:\n"
            "- Use ONLY the numeric ID from the database (the number after [ID:...] in each profile entry)\n"
            "- NEVER use names, URLs, or slugs — ONLY integer IDs like 42, 17, 85\n"
            "- ONLY queue profiles whose Connection status is 'none' — skip anyone already queued/sent/connected\n"
            "- If a profile is already queued or sent, tell the user instead of re-queuing\n"
            "- Only include this block when the user explicitly asks to send/queue connections\n"
            "- Always explain your choices BEFORE the action block\n\n"
            "KEYWORD SEARCH ACTIONS:\n"
            "If the user wants to DISCOVER NEW profiles (not from existing DB), suggest search keywords.\n"
            "When you detect this intent:\n"
            "1. Generate up to 5 relevant LinkedIn search keywords\n"
            "2. Explain your choices\n"
            "3. Include:\n"
            "[[ACTION:ADD_KEYWORDS]]\n"
            "KEYWORDS: keyword one, keyword two, keyword three\n"
            "[[/ACTION]]\n\n"
            "After keywords are confirmed and user says scan/search/go/yes, include:\n"
            "[[ACTION:START_SCAN]]\n"
            "KEYWORDS: keyword one, keyword two, keyword three\n"
            "PAGES: 3\n"
            "[[/ACTION]]\n"
            "- Max 5 keywords, max 10 pages (default 3)\n"
            "- Keywords should be specific LinkedIn profile terms\n\n"
            f"DATABASE: {profile_count} profiles found.\n\n"
            f"{profiles_context}"
        )

    if body.include_web_search and body.web_search_query:
        from app.routers.settings import resolve_api_key
        serper_key = await resolve_api_key()
        if serper_key:
            web_results = await _web_search(body.web_search_query, serper_key)
            system_prompt += (
                f"\n\n--- WEB SEARCH RESULTS for \"{body.web_search_query}\" ---\n"
                f"{web_results}\n"
                "--- END WEB SEARCH RESULTS ---\n\n"
                "Use these web search results to provide detailed, up-to-date information about the person or topic. "
                "Summarize what you found clearly and highlight key insights relevant to LinkedIn networking."
            )
        else:
            system_prompt += "\n\n[Web search unavailable — no Serper API key configured.]"

    if body.context:
        system_prompt += f"\n\nAdditional context:\n{body.context}"

    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    async def stream_response():
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                if provider == "openai":
                    async for chunk in _stream_openai(client, api_key, model, system_prompt, messages):
                        yield f"data: {chunk}\n\n"
                elif provider == "anthropic":
                    async for chunk in _stream_anthropic(client, api_key, model, system_prompt, messages):
                        yield f"data: {chunk}\n\n"
                elif provider == "gemini":
                    async for chunk in _stream_gemini(client, api_key, model, system_prompt, messages):
                        yield f"data: {chunk}\n\n"
                elif provider == "bedrock":
                    async for chunk in _stream_bedrock(client, api_key, bedrock_region, model, system_prompt, messages):
                        yield f"data: {chunk}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                logger.error(f"Chat error ({provider}): {e}")
                yield f'data: {{"error": "{str(e)}"}}\n\n'

    return StreamingResponse(stream_response(), media_type="text/event-stream")


async def _stream_openai(client: httpx.AsyncClient, api_key: str, model: str, system: str, messages: list):
    import json
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}] + messages,
        "stream": True,
    }
    async with client.stream(
        "POST",
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
    ) as resp:
        if resp.status_code != 200:
            body = await resp.aread()
            raise Exception(f"OpenAI API error {resp.status_code}: {body.decode()[:200]}")
        async for line in resp.aiter_lines():
            if line.startswith("data: ") and line != "data: [DONE]":
                try:
                    data = json.loads(line[6:])
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield json.dumps({"content": content})
                except json.JSONDecodeError:
                    pass


async def _stream_anthropic(client: httpx.AsyncClient, api_key: str, model: str, system: str, messages: list):
    import json
    payload = {
        "model": model,
        "max_tokens": 4096,
        "system": system,
        "messages": messages,
        "stream": True,
    }
    async with client.stream(
        "POST",
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json=payload,
    ) as resp:
        if resp.status_code != 200:
            body = await resp.aread()
            raise Exception(f"Anthropic API error {resp.status_code}: {body.decode()[:200]}")
        async for line in resp.aiter_lines():
            if line.startswith("data: "):
                try:
                    data = json.loads(line[6:])
                    if data.get("type") == "content_block_delta":
                        content = data.get("delta", {}).get("text", "")
                        if content:
                            yield json.dumps({"content": content})
                except json.JSONDecodeError:
                    pass


async def _stream_bedrock(client: httpx.AsyncClient, api_key: str, region: str, model: str, system: str, messages: list):
    import json
    import asyncio
    import boto3

    bedrock = boto3.client("bedrock-runtime", region_name=region)

    payload = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 4096,
        "system": system,
        "messages": messages,
    })

    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None,
        lambda: bedrock.invoke_model_with_response_stream(
            modelId=model,
            contentType="application/json",
            accept="application/json",
            body=payload,
        ),
    )

    for event in response["body"]:
        chunk = json.loads(event["chunk"]["bytes"])
        if chunk.get("type") == "content_block_delta":
            text = chunk.get("delta", {}).get("text", "")
            if text:
                yield json.dumps({"content": text})


async def _stream_gemini(client: httpx.AsyncClient, api_key: str, model: str, system: str, messages: list):
    import json
    contents = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    payload = {
        "contents": contents,
        "systemInstruction": {"parts": [{"text": system}]},
        "generationConfig": {"maxOutputTokens": 4096},
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?key={api_key}&alt=sse"

    async with client.stream("POST", url, json=payload) as resp:
        if resp.status_code != 200:
            body = await resp.aread()
            raise Exception(f"Gemini API error {resp.status_code}: {body.decode()[:200]}")
        async for line in resp.aiter_lines():
            if line.startswith("data: "):
                try:
                    data = json.loads(line[6:])
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            text = part.get("text", "")
                            if text:
                                yield json.dumps({"content": text})
                except json.JSONDecodeError:
                    pass
