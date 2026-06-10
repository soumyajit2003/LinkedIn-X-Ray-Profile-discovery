import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

DATABASE_PATH = Path(__file__).resolve().parent.parent / "data.db"
LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
DAILY_QUOTA_LIMIT = 2500
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
DAILY_CONNECTION_LIMIT = 50

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
BEDROCK_API_KEY = os.getenv("BEDROCK_API_KEY", "")
BEDROCK_REGION = os.getenv("BEDROCK_REGION", "")
BEDROCK_MODEL = os.getenv("BEDROCK_MODEL", "")
