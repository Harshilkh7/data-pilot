"""
database.py — Database connection management for DataPilot.

Design principles:
  - Credentials are NEVER persisted to disk. Each session stores its SQLAlchemy
    engine in an in-memory dict (SESSION_STORE) keyed by a UUID session_id.
  - Schema inspection uses the primary engine (full privileges).
  - Query execution uses a separate read-only engine when READ_ONLY_MODE=True.
  - For production deployments, always configure a dedicated read-only DB role.
    See `create_read_only_role_instructions()` below.

Supported databases: PostgreSQL, MySQL, SQLite.
"""

import uuid
import logging
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import create_engine, text, inspect, Engine
from sqlalchemy.exc import SQLAlchemyError

from config import DATABASE_URL, READ_ONLY_DATABASE_URL, READ_ONLY_MODE

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# In-memory session store — keyed by session_id (UUID string)
# ---------------------------------------------------------------------------
@dataclass
class SessionData:
    """Holds runtime state for a single user connection session."""
    session_id: str
    # Primary engine — used for schema inspection (may have broader privileges)
    engine: Engine
    # Read-only engine — used for query execution.
    # If READ_ONLY_MODE=False this is the same object as `engine`.
    read_only_engine: Engine
    db_type: str           # "postgresql" | "mysql" | "sqlite"
    database_name: str     # For display purposes
    table_names: list[str] = field(default_factory=list)


# Module-level in-memory store. Sessions expire when the process restarts.
SESSION_STORE: dict[str, SessionData] = {}


# ---------------------------------------------------------------------------
# Read-only role setup instructions (documentation for operators)
# ---------------------------------------------------------------------------
def create_read_only_role_instructions() -> str:
    """
    Returns a string documenting how to create a Postgres read-only role.

    This function is NOT called at runtime — it exists as executable documentation
    and is referenced in the README. Run `python -c "from database import
    create_read_only_role_instructions; print(create_read_only_role_instructions())"
    to print the instructions.

    SQL to run as a superuser against your Postgres database:
    -------------------------------------------------------------------------
    -- 1. Create the role (no login password set here — change as needed)
    CREATE ROLE datapilot_readonly WITH LOGIN PASSWORD 'strong_password_here';

    -- 2. Grant connection privileges on the database
    GRANT CONNECT ON DATABASE your_database_name TO querymind_readonly;

    -- 3. Grant usage on the schema(s) you want to expose
    GRANT USAGE ON SCHEMA public TO querymind_readonly;

    -- 4. Grant SELECT on all existing tables
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO querymind_readonly;

    -- 5. Grant SELECT on future tables automatically
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT ON TABLES TO querymind_readonly;
    -------------------------------------------------------------------------

    Then set in .env:
        READ_ONLY_MODE=true
        READ_ONLY_DATABASE_URL=postgresql://querymind_readonly:strong_password_here@host:5432/your_database_name
    """
    return create_read_only_role_instructions.__doc__ or ""


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------
def _detect_db_type(connection_string: str) -> str:
    """Infer a human-readable DB type label from the connection string prefix."""
    cs = connection_string.lower()
    if cs.startswith("postgresql") or cs.startswith("postgres"):
        return "postgresql"
    if cs.startswith("mysql"):
        return "mysql"
    if cs.startswith("sqlite"):
        return "sqlite"
    return "unknown"


def _detect_database_name(connection_string: str, db_type: str) -> str:
    """Extract the database/file name from the connection string for display."""
    try:
        if db_type == "sqlite":
            # e.g. sqlite:///./chinook.db → chinook.db
            return connection_string.rstrip("/").split("/")[-1]
        else:
            # e.g. postgresql://user:pass@host:5432/mydb → mydb
            return connection_string.rstrip("/").split("/")[-1].split("?")[0]
    except Exception:
        return "unknown"


def _build_engine(connection_string: str) -> Engine:
    """
    Create a SQLAlchemy engine with safe defaults.

    - pool_pre_ping=True: validates connections before use (avoids stale connections).
    - pool_recycle=3600: recycle connections every hour (avoids idle timeout errors).
    - connect_args for SQLite: enables WAL mode for concurrent read access.
    """
    kwargs: dict = {
        "pool_pre_ping": True,
        "pool_recycle": 3600,
    }
    # SQLite does not support connection pooling parameters
    if connection_string.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}

    return create_engine(connection_string, **kwargs)


def validate_and_connect(
    connection_string: str,
    read_only_connection_string: Optional[str] = None,
) -> tuple[str, "SessionData"]:
    """
    Validate the connection by executing `SELECT 1`, then store a new session.

    Args:
        connection_string: Primary DB connection string (for schema inspection).
        read_only_connection_string: Optional separate read-only connection string.
            If None and READ_ONLY_MODE is True, uses the global READ_ONLY_DATABASE_URL.

    Returns:
        (session_id, SessionData)

    Raises:
        ValueError: If the connection cannot be established or SELECT 1 fails.
    """
    engine = _build_engine(connection_string)

    # Lightweight connection test
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise ValueError(f"Database connection failed: {exc}") from exc

    # Determine read-only engine
    ro_conn_str = (
        read_only_connection_string
        or (READ_ONLY_DATABASE_URL if READ_ONLY_MODE else None)
    )
    if ro_conn_str:
        ro_engine = _build_engine(ro_conn_str)
        try:
            with ro_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except SQLAlchemyError as exc:
            raise ValueError(
                f"Read-only database connection failed: {exc}"
            ) from exc
        logger.info("Read-only engine configured for query execution.")
    else:
        ro_engine = engine
        logger.info(
            "READ_ONLY_MODE is disabled — using primary engine for query execution. "
            "Not recommended for production."
        )

    db_type = _detect_db_type(connection_string)
    db_name = _detect_database_name(connection_string, db_type)

    # Gather table names via inspector
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    session_id = str(uuid.uuid4())
    session = SessionData(
        session_id=session_id,
        engine=engine,
        read_only_engine=ro_engine,
        db_type=db_type,
        database_name=db_name,
        table_names=table_names,
    )
    SESSION_STORE[session_id] = session
    logger.info(
        "Session %s created for database '%s' (%s tables).",
        session_id,
        db_name,
        len(table_names),
    )
    return session_id, session


def get_session(session_id: str) -> SessionData:
    """Return a stored session or raise KeyError if it doesn't exist."""
    if session_id not in SESSION_STORE:
        raise KeyError(f"No active session found for session_id='{session_id}'. "
                       "Please reconnect via /api/connect.")
    return SESSION_STORE[session_id]


def remove_session(session_id: str) -> None:
    """Dispose of a session's engine connections and remove from store."""
    if session_id in SESSION_STORE:
        session = SESSION_STORE.pop(session_id)
        try:
            session.engine.dispose()
            if session.read_only_engine is not session.engine:
                session.read_only_engine.dispose()
        except Exception as exc:
            logger.warning("Error disposing engine for session %s: %s", session_id, exc)


def get_schema_overview(session_id: str) -> list[dict]:
    """
    Return a lightweight overview of the database: table names + row counts.
    Uses the primary engine for inspection.

    Returns:
        List of dicts: [{"table": "artists", "row_count": 275}, ...]
    """
    session = get_session(session_id)
    overview = []
    with session.engine.connect() as conn:
        for table in session.table_names:
            try:
                result = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"'))
                count = result.scalar() or 0
            except Exception:
                count = -1  # Unknown — don't crash schema overview on inaccessible tables
            overview.append({"table": table, "row_count": count})
    return overview


def connect_from_demo() -> tuple[str, "SessionData"]:
    """
    Create a session using the default demo database (DATABASE_URL from config).
    Used for the quick-start demo mode without requiring the user to provide credentials.
    """
    return validate_and_connect(DATABASE_URL)
