import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import database
from app.config import LOG_DIR, LOG_LEVEL
from app.routers import search, results, export, settings, quota, connections, enrichment, chat, projects


def setup_logging() -> None:
    LOG_DIR.mkdir(exist_ok=True)
    file_handler = RotatingFileHandler(
        LOG_DIR / "app.log", maxBytes=5_000_000, backupCount=3
    )
    file_handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    file_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    root_logger.addHandler(file_handler)
    root_logger.addHandler(logging.StreamHandler())


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    await database.init_db()
    yield


app = FastAPI(title="LinkedIn X-Ray Search API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://www.linkedin.com", "chrome-extension://*"],
    allow_origin_regex=r"(https://.*\.linkedin\.com)|(chrome-extension://.*)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(results.router)
app.include_router(export.router)
app.include_router(settings.router)
app.include_router(quota.router)
app.include_router(connections.router)
app.include_router(enrichment.router)
app.include_router(chat.router)
app.include_router(projects.router)
