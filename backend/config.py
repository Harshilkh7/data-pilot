"""DataPilot configuration."""
import os
from pathlib import Path
from dotenv import load_dotenv
_PROJECT_ROOT=Path(__file__).parent.parent
load_dotenv(_PROJECT_ROOT/".env")
def _require_env(key):
    value=os.environ.get(key,"").strip()
    if not value: raise RuntimeError(f"Required environment variable '{key}' is missing.")
    return value
GEMINI_API_KEY=_require_env("GEMINI_API_KEY")
DATABASE_URL=os.environ.get("DATABASE_URL",f"sqlite:///{(_PROJECT_ROOT/'chinook.db').resolve().as_posix()}")
READ_ONLY_DATABASE_URL=os.environ.get("READ_ONLY_DATABASE_URL") or None
READ_ONLY_MODE=os.environ.get("READ_ONLY_MODE","false").lower() in ("1","true","yes")
if READ_ONLY_MODE and not READ_ONLY_DATABASE_URL: raise RuntimeError("READ_ONLY_MODE=true requires READ_ONLY_DATABASE_URL")
FRONTEND_ORIGIN=os.environ.get("FRONTEND_ORIGIN","http://localhost:5173").rstrip("/")
ALLOWED_ORIGINS=[FRONTEND_ORIGIN,"http://localhost:5173","http://localhost:3000","http://127.0.0.1:5173","http://127.0.0.1:3000"]
GEMINI_MODEL=os.environ.get("GEMINI_MODEL","gemini-2.5-flash")
GEMINI_API_BASE="https://generativelanguage.googleapis.com/v1beta"
MAX_AGENT_ATTEMPTS=int(os.environ.get("MAX_AGENT_ATTEMPTS","3"))
DEFAULT_ROW_LIMIT=int(os.environ.get("DEFAULT_ROW_LIMIT","500"))
ALL_ROWS_LIMIT=int(os.environ.get("ALL_ROWS_LIMIT","10000"))
RAG_TOP_K=int(os.environ.get("RAG_TOP_K","5"))
RAG_SKIP_THRESHOLD=int(os.environ.get("RAG_SKIP_THRESHOLD","10"))
