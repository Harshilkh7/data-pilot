"""
main.py — DataPilot FastAPI application.

Endpoints:
  POST /api/connect — validate DB connection, create session, return schema overview
  POST /api/demo-connect — create a credential-free e-commerce demo session
  POST /api/query — run the natural-language-to-SQL query pipeline
  DELETE /api/session/{session_id} — clean up a session
  GET /api/health — liveness probe
"""
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import config
from database import validate_and_connect, get_schema_overview, remove_session, connect_from_demo, SESSION_STORE
from rag import embed_schema
from agent import run_query

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("  DataPilot API starting up")
    logger.info("  Gemini model: %s", config.GEMINI_MODEL)
    logger.info("  Demo DB     : %s", config.DATABASE_URL)
    logger.info("  Read-only   : %s", config.READ_ONLY_MODE)
    logger.info("  CORS origins: %s", config.ALLOWED_ORIGINS)
    logger.info("=" * 60)
    yield
    for sid in list(SESSION_STORE.keys()):
        remove_session(sid)
    logger.info("DataPilot API shut down cleanly.")

app = FastAPI(
    title="DataPilot API",
    description="Natural Language to SQL Data Analyst — agentic query engine.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

class ConnectRequest(BaseModel):
    connection_string: Optional[str] = Field(None, description="Full SQLAlchemy connection string")
    db_type: Optional[str] = Field(None, description="'postgresql', 'mysql', or 'sqlite'")
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    database: Optional[str] = Field(None, description="Database name or file path")
    username: Optional[str] = Field(None, description="Database username")
    password: Optional[str] = Field(None, description="Database password")
    read_only_connection_string: Optional[str] = Field(None, description="Optional read-only connection string")

class ConnectResponse(BaseModel):
    session_id: str
    database_name: str
    db_type: str
    schema_overview: list[dict]
    message: str

class QueryRequest(BaseModel):
    session_id: str = Field(..., description="Session ID returned by /api/connect")
    question: str = Field(..., description="Natural language question to query the database")

class QueryResponse(BaseModel):
    sql: str
    summary: str
    columns: list[str]
    rows: list[list]
    row_count: int
    truncated: bool
    limit_note: str
    chart_suggestion: Optional[dict]
    error: Optional[str]
    elapsed_ms: float

def _build_connection_string(req: ConnectRequest) -> str:
    db = req.db_type.lower().strip()
    if db == "sqlite":
        return f"sqlite:///{req.database or './data.db'}"
    if db == "postgresql":
        driver = "postgresql+psycopg2"
    elif db == "mysql":
        driver = "mysql+pymysql"
    else:
        raise ValueError(f"Unsupported db_type: '{req.db_type}'. Use postgresql, mysql, or sqlite.")
    port = req.port or (5432 if db == "postgresql" else 3306)
    return f"{driver}://{req.username}:{req.password}@{req.host}:{port}/{req.database}"

@app.get("/api/health", tags=["Meta"])
async def health():
    return {"status": "ok", "sessions_active": len(SESSION_STORE)}

@app.post("/api/connect", response_model=ConnectResponse, tags=["Connection"])
async def connect(req: ConnectRequest):
    if req.connection_string:
        conn_str = req.connection_string.strip()
    elif req.db_type and req.database:
        try:
            conn_str = _build_connection_string(req)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    else:
        raise HTTPException(status_code=400, detail="Provide either 'connection_string' or structured database fields.")

    try:
        session_id, session = validate_and_connect(conn_str, read_only_connection_string=req.read_only_connection_string)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Unexpected error during connect")
        raise HTTPException(status_code=500, detail=f"Connection error: {exc}")

    try:
        embed_schema(session_id)
    except Exception as exc:
        logger.warning("Schema embedding failed for session %s: %s", session_id, exc)

    try:
        overview = get_schema_overview(session_id)
    except Exception:
        overview = [{"table": t, "row_count": -1} for t in session.table_names]

    return ConnectResponse(
        session_id=session_id,
        database_name=session.database_name,
        db_type=session.db_type,
        schema_overview=overview,
        message=f"Connected to '{session.database_name}' ({len(session.table_names)} tables).",
    )

@app.post("/api/demo-connect", response_model=ConnectResponse, tags=["Connection"])
async def demo_connect():
    """Create a credential-free session backed by the seeded e-commerce SQLite demo."""
    try:
        session_id, session = connect_from_demo()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Demo connect failed")
        raise HTTPException(
            status_code=500,
            detail=f"E-commerce demo database connection failed: {exc}.",
        )

    try:
        embed_schema(session_id)
    except Exception as exc:
        logger.warning("Demo schema embedding failed: %s", exc)

    try:
        overview = get_schema_overview(session_id)
    except Exception:
        overview = [{"table": t, "row_count": -1} for t in session.table_names]

    return ConnectResponse(
        session_id=session_id,
        database_name=session.database_name,
        db_type=session.db_type,
        schema_overview=overview,
        message=f"Demo mode: connected to '{session.database_name}' ({len(session.table_names)} tables).",
    )

@app.post("/api/query", response_model=QueryResponse, tags=["Query"])
async def query(req: QueryRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    if req.session_id not in SESSION_STORE:
        raise HTTPException(status_code=404, detail=f"Session '{req.session_id}' not found. Please reconnect via /api/connect.")

    start = time.perf_counter()
    try:
        result = run_query(session_id=req.session_id, question=req.question.strip())
    except Exception as exc:
        logger.exception("run_query raised an unexpected exception")
        raise HTTPException(status_code=500, detail=f"Query pipeline error: {exc}")
    elapsed_ms = (time.perf_counter() - start) * 1000

    return QueryResponse(
        sql=result["sql"],
        summary=result["summary"],
        columns=result["columns"],
        rows=result["rows"],
        row_count=result["row_count"],
        truncated=result["truncated"],
        limit_note=result["limit_note"],
        chart_suggestion=result["chart_suggestion"],
        error=result.get("error"),
        elapsed_ms=round(elapsed_ms, 1),
    )

@app.delete("/api/session/{session_id}", tags=["Connection"])
async def disconnect(session_id: str):
    if session_id not in SESSION_STORE:
        raise HTTPException(status_code=404, detail="Session not found.")
    remove_session(session_id)
    return {"message": f"Session '{session_id}' disconnected."}

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(status_code=500, content={"detail": f"Internal server error: {type(exc).__name__}: {exc}"})
