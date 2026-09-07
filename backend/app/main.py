import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import RateLimitError
from pydantic_settings import BaseSettings, SettingsConfigDict
from .schemas import ParseRequest, MapRequest
from .services.resume_parser import decode_upload, extract_text
from .ai.client import AIClient

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.teamorouter.com/v1"
    OPENAI_MODEL: str = "gpt-5.6-luna"
    ALLOWED_ORIGINS: str = "http://localhost:5173"
    MAX_RESUME_BYTES: int = 8000000
    # Demo only: when true, /api/parse-resume returns a fixed profile instead
    # of calling the AI. Production default is false (real parsing).
    USE_MOCK: bool = False


settings = Settings()
app = FastAPI(title="Workday AI Autofill API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings.ALLOWED_ORIGINS.split(",") if x.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.on_event("startup")
def log_ai_agent():
    logger.warning("AI agent/model configured: %s", settings.OPENAI_MODEL)


def client():
    if not settings.OPENAI_API_KEY:
        raise HTTPException(503, "OPENAI_API_KEY is not configured.")
    logger.info("Using AI agent/model: %s", settings.OPENAI_MODEL)
    return AIClient(
        settings.OPENAI_API_KEY, settings.OPENAI_MODEL, settings.OPENAI_BASE_URL
    )


@app.get("/health")
def health():
    return {"status": "ok", "ai_configured": bool(settings.OPENAI_API_KEY)}


@app.post("/api/parse-resume")
def parse_resume(req: ParseRequest):
    try:
        data = decode_upload(req.content_base64, settings.MAX_RESUME_BYTES)
        text = extract_text(req.filename, data)
        if not text.strip():
            raise ValueError("No readable text found in the uploaded resume.")
        logger.info("Parsed resume %s: %d chars extracted", req.filename, len(text))
        return client().parse_resume(text).model_dump()
    except HTTPException:
        logger.error("HTTPException occurred while parsing resume.")
        raise
    except RateLimitError as e:
        logger.error("AI provider quota/rate limit hit: %s", e)
        raise HTTPException(
            503,
            "AI provider rate limit or quota exceeded. Please retry later "
            "or set USE_MOCK=true in backend/.env for demo mode.",
        )
    except Exception as e:
        logger.exception("Error parsing resume: %s", e)
        raise HTTPException(400, str(e))


@app.post("/api/map-fields")
def map_fields(req: MapRequest):
    try:
        return [x.model_dump() for x in client().map_fields(req.resume, req.fields)]
    except HTTPException:
        logger.error("HTTPException occurred while mapping fields.")
        raise
    except Exception as e:
        logger.exception("Error mapping fields: %s", e)
        raise HTTPException(400, str(e))
