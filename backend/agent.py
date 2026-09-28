"""
agent.py — LangGraph agentic workflow for DataPilot.

Graph flow:
    retrieve_schema
        → generate_sql        (LLM: Gemini llama-3.3-70b-versatile)
        → validate_sql        (sqlglot: parse + reject DDL/DML)
        → limit_inject        (enforce LIMIT before execution)
        → execute_sql         (read-only DB engine)
        → summarize_results   (LLM: Gemini)
        → END

Retry logic:
    - validate_sql failure → back to generate_sql (with parse error in context)
    - execute_sql failure  → back to generate_sql (with DB error in context)
    - Max MAX_AGENT_ATTEMPTS total combined retries. On exhaustion → END with error.

The LLM is called directly via the Gemini Python SDK (no LangChain).
"""

import json
import logging
import re
import time
from typing import Annotated, Any, Optional
from typing_extensions import TypedDict

import sqlglot
import sqlglot.errors
import pandas as pd
import urllib.request, urllib.error
from langgraph.graph import StateGraph, END

from config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_API_BASE,
    MAX_AGENT_ATTEMPTS,
    DEFAULT_ROW_LIMIT,
    ALL_ROWS_LIMIT,
)
from database import get_session
from rag import (
    retrieve_relevant_tables,
    get_full_schema_cached,
    schema_to_sql_ddl,
    TableSchema,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Gemini API helper
# ---------------------------------------------------------------------------
def _call_gemini_with_retry(messages, model=GEMINI_MODEL, temperature=0.0, max_tokens=1024, max_retries=5):
    prompt = "\n\n".join(m.get("content", "") for m in messages)
    payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}}
    url = f"{GEMINI_API_BASE}/models/{model}:generateContent?key={GEMINI_API_KEY}"
    delay = 2.0
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=60) as response:
                data = json.loads(response.read().decode())
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return type("Response", (), {"choices": [type("Choice", (), {"message": type("Message", (), {"content": text})()})()]})()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="ignore")
            if exc.code in (429,500,502,503,504) and attempt < max_retries-1:
                time.sleep(delay); delay=min(delay*2,12); continue
            raise RuntimeError(f"Gemini API error {exc.code}: {body[:500]}") from exc
        except Exception:
            if attempt < max_retries-1:
                time.sleep(delay); delay=min(delay*2,12); continue
            raise

# ---------------------------------------------------------------------------
# Agent State
# ---------------------------------------------------------------------------
class AgentState(TypedDict):
    session_id: str
    question: str

    # Schema (populated by retrieve_schema)
    full_schema: list[TableSchema]
    relevant_schema: list[TableSchema]

    # SQL generation (populated/updated by generate_sql)
    sql: str
    attempt_count: int
    error_context: str          # Error message passed back for self-correction

    # Limit injection (populated by limit_inject)
    truncated: bool
    limit_note: str             # Human-readable note if limit was injected

    # Execution results (populated by execute_sql)
    columns: list[str]
    rows: list[list[Any]]
    row_count: int

    # Summary (populated by summarize_results)
    summary: str

    # Chart suggestion (populated by summarize_results)
    chart_suggestion: Optional[dict]

    # Final error message if all retries exhausted
    final_error: str


# ---------------------------------------------------------------------------
# Helper: chart suggestion heuristic
# ---------------------------------------------------------------------------
_CHART_KEYWORDS = {
    "bar": ["count", "total", "sum", "average", "avg", "per", "by", "group"],
    "line": ["over time", "trend", "monthly", "yearly", "daily", "date"],
    "pie": ["proportion", "percentage", "share", "distribution", "breakdown"],
}


def _suggest_chart(question: str, columns: list[str], rows: list[list]) -> Optional[dict]:
    """
    Heuristically suggest a chart type based on the question and result shape.
    Returns None if the data doesn't look chartable (e.g. single row, too many columns).
    """
    if len(rows) < 2 or len(columns) < 2 or len(columns) > 6:
        return None

    q = question.lower()
    # Check for time-series columns
    time_cols = [c for c in columns if any(t in c.lower() for t in ["date", "year", "month", "time"])]
    numeric_cols = [c for c in columns if c not in time_cols]

    for chart_type, keywords in _CHART_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            if chart_type == "line" and time_cols and numeric_cols:
                return {"type": "line", "x": time_cols[0], "y": numeric_cols[0]}
            if chart_type in ("bar", "pie") and len(columns) >= 2:
                return {"type": chart_type, "x": columns[0], "y": columns[1]}

    # Default: if exactly 2 columns (label + number), suggest bar
    if len(columns) == 2:
        return {"type": "bar", "x": columns[0], "y": columns[1]}

    return None


# ---------------------------------------------------------------------------
# Keywords that imply the user wants all/every row
# ---------------------------------------------------------------------------
_ALL_ROWS_KEYWORDS = re.compile(
    r"\b(all|every|entire|full|export|complete|whole)\b", re.IGNORECASE
)


# ---------------------------------------------------------------------------
# Node: retrieve_schema
# ---------------------------------------------------------------------------
def retrieve_schema(state: AgentState) -> AgentState:
    """Fetch relevant tables via RAG (or full schema for small DBs)."""
    session_id = state["session_id"]
    question = state["question"]

    try:
        full_schema = get_full_schema_cached(session_id)
        relevant = retrieve_relevant_tables(session_id, question, full_schema)
        return {**state, "full_schema": full_schema, "relevant_schema": relevant}
    except Exception as exc:
        logger.error("retrieve_schema failed: %s", exc)
        return {**state, "full_schema": [], "relevant_schema": [], "final_error": str(exc)}


# ---------------------------------------------------------------------------
# Node: generate_sql
# ---------------------------------------------------------------------------
_SYSTEM_PROMPT = """You are a precise SQL assistant. Your ONLY job is to write a single SQL SELECT query.

Rules (STRICT — violations will cause your output to be rejected):
1. Output ONLY the raw SQL query. No markdown, no code fences, no comments, no explanation.
2. The query MUST be a SELECT statement. Never write INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, or any DDL/DML.
3. Use ONLY the tables and columns provided in the schema below. Do not invent table or column names.
4. For questions asking for a single top/extreme value (e.g., "most", "longest", "highest", "earliest", "top", "best") or a specific number of items (e.g. "top 3", "5 oldest"), you MUST include a LIMIT clause (e.g. LIMIT 1, LIMIT 3, etc.) to restrict the output to only the requested number of rows. Otherwise, do not include any LIMIT clause.
5. If the question cannot be answered from the provided schema, output exactly: CANNOT_ANSWER
6. For questions asking for "which [entity] has the most/highest [property]" or "top/best" (e.g., top artist by albums, top spending customer, country with most customers, genre with most tracks), ALWAYS select BOTH the entity's identifier/name/descriptor (e.g. ArtistId, Name, CustomerId, Country) AND the aggregate metric (e.g. COUNT(AlbumId) AS AlbumCount, SUM(Total) AS TotalSpent) so they are both in the SELECT clause.

Schema:
{schema}
"""


def generate_sql(state: AgentState) -> AgentState:
    """Call Gemini to generate a SQL query from the question and relevant schema."""
    attempt = state.get("attempt_count", 0) + 1
    question = state["question"]
    schema_ddl = schema_to_sql_ddl(state["relevant_schema"])
    error_ctx = state.get("error_context", "")

    user_message = f"Question: {question}"
    if error_ctx:
        user_message += (
            f"\n\nPrevious attempt failed with this error — fix it:\n{error_ctx}"
        )

    logger.info("generate_sql attempt %d for question: %r", attempt, question[:80])

    try:
        response = _call_gemini_with_retry(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT.format(schema=schema_ddl)},
                {"role": "user", "content": user_message},
            ],
            model=GEMINI_MODEL,
            temperature=0.0,
            max_tokens=1024,
        )
        sql = response.choices[0].message.content.strip()

        # Strip accidental markdown fences
        sql = re.sub(r"^```[a-zA-Z]*\n?", "", sql, flags=re.MULTILINE)
        sql = re.sub(r"```$", "", sql, flags=re.MULTILINE).strip()

        logger.info("generate_sql produced: %s", sql[:200])
        return {**state, "sql": sql, "attempt_count": attempt, "error_context": ""}

    except Exception as exc:
        logger.error("generate_sql LLM call failed: %s", exc)
        return {
            **state,
            "sql": "",
            "attempt_count": attempt,
            "final_error": f"LLM call failed: {exc}",
        }


# ---------------------------------------------------------------------------
# Node: validate_sql
# ---------------------------------------------------------------------------
_FORBIDDEN_STATEMENTS = {
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
    "TRUNCATE", "REPLACE", "MERGE", "UPSERT", "GRANT", "REVOKE",
}


def validate_sql(state: AgentState) -> AgentState:
    """
    Parse SQL with sqlglot. Reject non-SELECT or DDL/DML statements.
    Routes back to generate_sql on failure (up to MAX_AGENT_ATTEMPTS).
    """
    sql = state.get("sql", "").strip()

    if not sql or sql == "CANNOT_ANSWER":
        return {
            **state,
            "final_error": (
                "The assistant could not determine a SQL query for your question "
                "based on the available schema."
            ),
        }

    try:
        parsed = sqlglot.parse(sql)
    except sqlglot.errors.ParseError as exc:
        error_msg = f"SQL parse error: {exc}"
        logger.warning("validate_sql parse error: %s", error_msg)
        return {**state, "error_context": error_msg}

    if not parsed:
        return {**state, "error_context": "sqlglot returned an empty parse result."}

    # Check every statement — all must be SELECT
    for stmt in parsed:
        stmt_type = type(stmt).__name__.upper()
        # sqlglot uses class names like "Select", "Insert", etc.
        if stmt_type != "SELECT":
            error_msg = (
                f"Only SELECT queries are permitted. Got: {stmt_type}. "
                f"Rewrite as a SELECT query."
            )
            logger.warning("validate_sql rejected statement type: %s", stmt_type)
            return {**state, "error_context": error_msg}

        # Belt-and-suspenders: check for forbidden keywords in the raw SQL
        sql_upper = sql.upper()
        for forbidden in _FORBIDDEN_STATEMENTS:
            # Use word boundaries to avoid false positives (e.g. "CREATED" column name)
            if re.search(rf"\b{forbidden}\b", sql_upper):
                error_msg = (
                    f"Forbidden SQL keyword detected: {forbidden}. "
                    f"Only SELECT statements are allowed."
                )
                logger.warning("validate_sql found forbidden keyword: %s", forbidden)
                return {**state, "error_context": error_msg}

    # All good
    logger.info("validate_sql: SQL is valid SELECT.")
    return {**state, "error_context": ""}


# ---------------------------------------------------------------------------
# Node: limit_inject
# ---------------------------------------------------------------------------
def limit_inject(state: AgentState) -> AgentState:
    """
    Enforce row limits BEFORE execution. Never allow fully unbounded queries.

    Logic:
      - If user implies "all/every/export" → cap at ALL_ROWS_LIMIT (10,000).
      - Otherwise → cap at DEFAULT_ROW_LIMIT (500).
      - If SQL already has a LIMIT clause ≤ the cap, leave it unchanged.
      - If SQL already has a LIMIT clause > the cap, replace it.
      - Always sets state["truncated"] and state["limit_note"] for transparency.
    """
    sql = state.get("sql", "").strip()
    question = state.get("question", "")
    implies_all = bool(_ALL_ROWS_KEYWORDS.search(question))
    cap = ALL_ROWS_LIMIT if implies_all else DEFAULT_ROW_LIMIT

    # Detect existing LIMIT clause (case-insensitive)
    limit_match = re.search(r"\bLIMIT\s+(\d+)\b", sql, re.IGNORECASE)

    if limit_match:
        existing_limit = int(limit_match.group(1))
        if existing_limit <= cap:
            # Existing limit is acceptable — leave it
            logger.info("limit_inject: existing LIMIT %d is within cap %d.", existing_limit, cap)
            return {**state, "truncated": False, "limit_note": ""}
        else:
            # Replace with cap
            sql = re.sub(
                r"\bLIMIT\s+\d+\b", f"LIMIT {cap}", sql, flags=re.IGNORECASE
            )
            note = (
                f"Your query's LIMIT was reduced to {cap} rows to protect database performance."
            )
            logger.info("limit_inject: replaced LIMIT %d with %d.", existing_limit, cap)
            return {**state, "sql": sql, "truncated": True, "limit_note": note}
    else:
        # No LIMIT — append one
        # Remove trailing semicolon before appending
        sql_clean = sql.rstrip(";").rstrip()
        sql = f"{sql_clean} LIMIT {cap}"
        if implies_all:
            note = (
                f"Results are capped at {cap:,} rows because your question implied retrieving "
                f"all rows. For safety, fully unbounded queries are not executed."
            )
        else:
            note = (
                f"Results are limited to {cap:,} rows. Use a more specific filter to see fewer results."
            )
        logger.info("limit_inject: appended LIMIT %d.", cap)
        return {**state, "sql": sql, "truncated": True, "limit_note": note}


# ---------------------------------------------------------------------------
# Node: execute_sql
# ---------------------------------------------------------------------------
def execute_sql(state: AgentState) -> AgentState:
    """
    Execute the validated, limit-injected SQL on the read-only engine.
    Converts results to a pandas DataFrame for type coercion and null handling.
    On DB error, routes back to generate_sql with the error message.
    """
    session_id = state["session_id"]
    sql = state.get("sql", "")

    try:
        session = get_session(session_id)
        with session.read_only_engine.connect() as conn:
            df = pd.read_sql_query(sql, conn)

        # Null handling — convert NaN/NaT to None for JSON serialization
        df = df.where(pd.notnull(df), other=None)

        columns = list(df.columns)
        rows = df.values.tolist()
        row_count = len(rows)

        logger.info("execute_sql: %d rows returned.", row_count)
        return {
            **state,
            "columns": columns,
            "rows": rows,
            "row_count": row_count,
            "error_context": "",
        }

    except Exception as exc:
        error_msg = f"Database execution error: {exc}"
        logger.warning("execute_sql failed: %s", error_msg)
        return {**state, "error_context": error_msg, "columns": [], "rows": [], "row_count": 0}


# ---------------------------------------------------------------------------
# Node: summarize_results
# ---------------------------------------------------------------------------
_SUMMARY_SYSTEM = (
    "You are a data analyst assistant. Given a SQL query result, write a concise "
    "1-3 sentence natural-language summary of the findings. "
    "Do not mention SQL syntax. Focus on what the data reveals."
)

# Max rows to include in the summary context (to stay within token limits)
_MAX_SUMMARY_ROWS = 50


def summarize_results(state: AgentState) -> AgentState:
    """Call Gemini to produce a natural-language summary of the query results."""
    question = state["question"]
    columns = state.get("columns", [])
    rows = state.get("rows", [])
    row_count = state.get("row_count", 0)

    # Sample data for large result sets
    sample_rows = rows[:_MAX_SUMMARY_ROWS]
    data_preview = json.dumps(
        {"columns": columns, "rows": sample_rows, "total_rows": row_count},
        default=str,
        indent=2,
    )

    user_msg = (
        f"User question: {question}\n\n"
        f"Query results (first {len(sample_rows)} of {row_count} rows):\n{data_preview}"
    )

    try:
        response = _call_gemini_with_retry(
            messages=[
                {"role": "system", "content": _SUMMARY_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            model=GEMINI_MODEL,
            temperature=0.3,
            max_tokens=256,
        )
        summary = response.choices[0].message.content.strip()
    except Exception as exc:
        logger.warning("summarize_results LLM call failed: %s", exc)
        summary = f"Query returned {row_count} row(s)."

    chart = _suggest_chart(question, columns, rows)
    return {**state, "summary": summary, "chart_suggestion": chart}


# ---------------------------------------------------------------------------
# Routing functions
# ---------------------------------------------------------------------------
def _should_retry_or_fail(state: AgentState, phase: str) -> str:
    """
    After validate_sql or execute_sql failure, decide whether to retry or give up.
    """
    if state.get("final_error"):
        return END

    error = state.get("error_context", "")
    attempt = state.get("attempt_count", 0)

    if error and attempt < MAX_AGENT_ATTEMPTS:
        logger.info("%s failed (attempt %d/%d) — routing to generate_sql.", phase, attempt, MAX_AGENT_ATTEMPTS)
        return "generate_sql"

    if error and attempt >= MAX_AGENT_ATTEMPTS:
        logger.error("%s: max attempts (%d) exhausted.", phase, MAX_AGENT_ATTEMPTS)
        # Inject a final_error so the graph ends
        state["final_error"] = (
            f"After {MAX_AGENT_ATTEMPTS} attempts, DataPilot could not generate a valid, "
            f"executable SQL query for your question.\n\n"
            f"Last attempted SQL:\n{state.get('sql', '(none)')}\n\n"
            f"Last error:\n{error}"
        )
        return END

    return "next"


def route_after_validate(state: AgentState) -> str:
    decision = _should_retry_or_fail(state, "validate_sql")
    if decision == "next":
        return "limit_inject"
    return decision


def route_after_execute(state: AgentState) -> str:
    decision = _should_retry_or_fail(state, "execute_sql")
    if decision == "next":
        return "summarize_results"
    return decision


def route_after_generate(state: AgentState) -> str:
    """If LLM call itself failed (final_error set), end immediately."""
    if state.get("final_error"):
        return END
    return "validate_sql"


# ---------------------------------------------------------------------------
# Build the LangGraph graph
# ---------------------------------------------------------------------------
def build_graph() -> "CompiledGraph":
    """Compile and return the LangGraph StateGraph."""
    builder = StateGraph(AgentState)

    builder.add_node("retrieve_schema", retrieve_schema)
    builder.add_node("generate_sql", generate_sql)
    builder.add_node("validate_sql", validate_sql)
    builder.add_node("limit_inject", limit_inject)
    builder.add_node("execute_sql", execute_sql)
    builder.add_node("summarize_results", summarize_results)

    builder.set_entry_point("retrieve_schema")

    builder.add_edge("retrieve_schema", "generate_sql")

    builder.add_conditional_edges(
        "generate_sql",
        route_after_generate,
        {"validate_sql": "validate_sql", END: END},
    )

    builder.add_conditional_edges(
        "validate_sql",
        route_after_validate,
        {
            "generate_sql": "generate_sql",
            "limit_inject": "limit_inject",
            END: END,
        },
    )

    builder.add_edge("limit_inject", "execute_sql")

    builder.add_conditional_edges(
        "execute_sql",
        route_after_execute,
        {
            "generate_sql": "generate_sql",
            "summarize_results": "summarize_results",
            END: END,
        },
    )

    builder.add_edge("summarize_results", END)

    return builder.compile()


# Module-level compiled graph — built once, reused across requests
_graph = None


def get_graph():
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def run_query(session_id: str, question: str) -> dict:
    """
    Run the full LangGraph pipeline for a natural-language question.

    Returns a dict matching the API response shape:
    {
        "sql": str,
        "summary": str,
        "columns": list[str],
        "rows": list[list],
        "row_count": int,
        "truncated": bool,
        "limit_note": str,
        "chart_suggestion": dict | None,
        "error": str | None,
    }
    """
    initial_state: AgentState = {
        "session_id": session_id,
        "question": question,
        "full_schema": [],
        "relevant_schema": [],
        "sql": "",
        "attempt_count": 0,
        "error_context": "",
        "truncated": False,
        "limit_note": "",
        "columns": [],
        "rows": [],
        "row_count": 0,
        "summary": "",
        "chart_suggestion": None,
        "final_error": "",
    }

    graph = get_graph()
    final_state: AgentState = graph.invoke(initial_state)

    error = final_state.get("final_error") or None
    return {
        "sql": final_state.get("sql", ""),
        "summary": final_state.get("summary", ""),
        "columns": final_state.get("columns", []),
        "rows": final_state.get("rows", []),
        "row_count": final_state.get("row_count", 0),
        "truncated": final_state.get("truncated", False),
        "limit_note": final_state.get("limit_note", ""),
        "chart_suggestion": final_state.get("chart_suggestion"),
        "error": error,
    }
