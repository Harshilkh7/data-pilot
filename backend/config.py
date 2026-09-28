"""DataPilot configuration."""
import os
from pathlib import Path
from dotenv import load_dotenv
ROOT=Path(__file__).parent.parent
load_dotenv(ROOT/".env")
def req(k):
 v=os.getenv(k,"").strip()
 if not v: raise RuntimeError(f"Missing required environment variable: {k}")
 return v
GEMINI_API_KEY=req("GEMINI_API_KEY")
GEMINI_MODEL=os.getenv("GEMINI_MODEL","gemini-3.8-flash")
GEMINI_API_BASE="https://generativelanguage.googleapis.com/v1beta"
DATABASE_URL=os.getenv("DATABASE_URL",f"sqlite:///{(ROOT/'chinook.db').resolve().as_posix()}")
READ_ONLY_DATABASE_URL=os.getenv("READ_ONLY_DATABASE_URL") or None
READ_ONLY_MODE=os.getenv("READ_ONLY_MODE","false").lower() in ("1","true","yes")
FRONTEND_ORIGIN=os.getenv("FRONTEND_ORIGIN","http://localhost:5173").rstrip("/")
ALLOWED_ORIGINS=list(dict.fromkeys([FRONTEND_ORIGIN,"http://localhost:5173","http://localhost:3000","http://127.0.0.1:5173"]))
MAX_AGENT_ATTEMPTS=int(os.getenv("MAX_AGENT_ATTEMPTS","3")); DEFAULT_ROW_LIMIT=int(os.getenv("DEFAULT_ROW_LIMIT","500")); ALL_ROWS_LIMIT=int(os.getenv("ALL_ROWS_LIMIT","10000")); RAG_TOP_K=int(os.getenv("RAG_TOP_K","5")); RAG_SKIP_THRESHOLD=int(os.getenv("RAG_SKIP_THRESHOLD","10"))
