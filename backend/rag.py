"""
rag.py — Schema extraction, natural-language table descriptions, and
ChromaDB-backed RAG retrieval for relevant tables.

Workflow:
  1. `extract_full_schema()` — reads all tables/columns/foreign keys via SQLAlchemy inspector.
  2. `describe_table()` — generates a natural-language description for each table.
  3. `embed_schema()` — stores descriptions in a per-session ChromaDB collection.
  4. `retrieve_relevant_tables()` — top-k semantic search against the collection.
  5. If total tables <= RAG_SKIP_THRESHOLD, skip embedding and return the full schema.
"""

import logging
from typing import Any

import json
import urllib.request
import urllib.error
import re
import chromadb
from sqlalchemy import inspect as sa_inspect

from config import RAG_TOP_K, RAG_SKIP_THRESHOLD, GEMINI_API_KEY
from database import get_session, SessionData

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hosted Embedding API (Google Gemini)
# ---------------------------------------------------------------------------

def _get_gemini_embeddings_batch(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key={GEMINI_API_KEY}"
    requests_list = [
        {
            "model": "models/gemini-embedding-001",
            "content": {"parts": [{"text": t}]}
        }
        for t in texts
    ]
    payload = {"requests": requests_list}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return [emb["values"] for emb in res_data["embeddings"]]
    except urllib.error.HTTPError as e:
        logger.error("Gemini batch embedding request failed: %s %s", e.code, e.read().decode("utf-8"))
        raise e
    except Exception as e:
        logger.error("Failed to get Gemini batch embeddings: %s", e)
        raise e


# ---------------------------------------------------------------------------
# ChromaDB client — in-process, ephemeral (no disk persistence between restarts)
# chromadb 1.x uses EphemeralClient() for in-memory storage
# ---------------------------------------------------------------------------
_chroma_client: Any = None


def _get_chroma_client() -> Any:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.EphemeralClient()
    return _chroma_client


def _collection_name(session_id: str) -> str:
    """ChromaDB collection names must be alphanumeric + hyphens, max 63 chars."""
    return f"schema-{session_id.replace('_', '-')}"[:63]


# ---------------------------------------------------------------------------
# Schema extraction
# ---------------------------------------------------------------------------
TableSchema = dict[str, Any]  # {"name", "columns": [...], "foreign_keys": [...]}


def extract_full_schema(session: SessionData) -> list[TableSchema]:
    """
    Extract full schema for all tables in the database.

    Returns a list of table dicts:
    {
        "name": "InvoiceLine",
        "columns": [
            {"name": "InvoiceLineId", "type": "INTEGER", "nullable": False, "primary_key": True},
            ...
        ],
        "foreign_keys": [
            {"column": "InvoiceId", "references_table": "Invoice", "references_column": "InvoiceId"},
            ...
        ]
    }
    """
    inspector = sa_inspect(session.engine)
    tables: list[TableSchema] = []

    for table_name in session.table_names:
        try:
            raw_cols = inspector.get_columns(table_name)
            pk_cols = set(inspector.get_pk_constraint(table_name).get("constrained_columns", []))
            raw_fks = inspector.get_foreign_keys(table_name)

            columns = [
                {
                    "name": col["name"],
                    "type": str(col["type"]),
                    "nullable": col.get("nullable", True),
                    "primary_key": col["name"] in pk_cols,
                }
                for col in raw_cols
            ]

            foreign_keys = [
                {
                    "column": fk["constrained_columns"][0] if fk["constrained_columns"] else "",
                    "references_table": fk["referred_table"],
                    "references_column": (
                        fk["referred_columns"][0] if fk["referred_columns"] else ""
                    ),
                }
                for fk in raw_fks
            ]

            tables.append(
                {"name": table_name, "columns": columns, "foreign_keys": foreign_keys}
            )
        except Exception as exc:
            logger.warning("Failed to inspect table '%s': %s", table_name, exc)

    return tables


def describe_table(table: TableSchema) -> str:
    """
    Generate a natural-language description of a table for embedding.

    Example output:
        "InvoiceLine: contains InvoiceLineId (INTEGER, PK), InvoiceId (INTEGER, FK→Invoice),
         TrackId (INTEGER, FK→Track), UnitPrice (NUMERIC), Quantity (INTEGER) —
         represents individual line items on a customer invoice."
    """
    col_parts = []
    fk_map = {fk["column"]: fk for fk in table["foreign_keys"]}

    for col in table["columns"]:
        tag = ""
        if col["primary_key"]:
            tag = ", PK"
        elif col["name"] in fk_map:
            fk = fk_map[col["name"]]
            tag = f", FK→{fk['references_table']}"
        col_parts.append(f"{col['name']} ({col['type']}{tag})")

    cols_str = ", ".join(col_parts)
    return (
        f"{table['name']}: contains {cols_str} — "
        f"a table in the database schema."
    )


def schema_to_sql_ddl(tables: list[TableSchema]) -> str:
    """
    Convert a list of TableSchema dicts to a compact SQL DDL string
    suitable for including in an LLM prompt.

    Example:
        Table: Artist
        Columns: ArtistId (INTEGER, PK), Name (NVARCHAR)
        --
    """
    lines = []
    for t in tables:
        lines.append(f"Table: {t['name']}")
        col_descs = []
        for col in t["columns"]:
            tags = []
            if col["primary_key"]:
                tags.append("PK")
            if not col["nullable"]:
                tags.append("NOT NULL")
            tag_str = f" [{', '.join(tags)}]" if tags else ""
            col_descs.append(f"  {col['name']} {col['type']}{tag_str}")
        lines.extend(col_descs)
        if t["foreign_keys"]:
            for fk in t["foreign_keys"]:
                lines.append(
                    f"  FK: {fk['column']} → {fk['references_table']}({fk['references_column']})"
                )
        lines.append("--")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# ChromaDB embedding & retrieval
# ---------------------------------------------------------------------------

def embed_schema(session_id: str) -> None:
    """
    Extract schema for `session_id`, generate descriptions, and store in ChromaDB.
    Called once after a successful database connection.
    """
    session = get_session(session_id)
    tables = extract_full_schema(session)

    if not tables:
        logger.warning("Session %s has no tables to embed.", session_id)
        return

    client = _get_chroma_client()
    collection_name = _collection_name(session_id)

    # Delete existing collection if it already exists (e.g. re-connection)
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass

    collection = client.create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    descriptions = [describe_table(t) for t in tables]
    embeddings = _get_gemini_embeddings_batch(descriptions)

    collection.add(
        ids=[t["name"] for t in tables],
        documents=descriptions,
        embeddings=embeddings,
        metadatas=[{"table_name": t["name"]} for t in tables],
    )
    logger.info(
        "Embedded %d table descriptions for session %s into ChromaDB.",
        len(tables),
        session_id,
    )


def retrieve_relevant_tables(
    session_id: str,
    question: str,
    full_schema: list[TableSchema],
) -> list[TableSchema]:
    """
    Return the top-k most relevant TableSchema dicts for the given question.

    If total tables <= RAG_SKIP_THRESHOLD, skip vector search and return all tables.
    Otherwise, query ChromaDB and return the matching subsets.
    """
    if len(full_schema) <= RAG_SKIP_THRESHOLD:
        logger.info(
            "Session %s has %d tables (≤ threshold %d) — skipping RAG, using full schema.",
            session_id,
            len(full_schema),
            RAG_SKIP_THRESHOLD,
        )
        return full_schema

    client = _get_chroma_client()
    collection_name = _collection_name(session_id)

    try:
        collection = client.get_collection(collection_name)
    except Exception:
        logger.warning(
            "ChromaDB collection not found for session %s — falling back to full schema.",
            session_id,
        )
        return full_schema

    question_embedding = _get_gemini_embeddings_batch([question])

    k = min(RAG_TOP_K, len(full_schema))
    results = collection.query(
        query_embeddings=question_embedding,
        n_results=k,
        include=["metadatas"],
    )

    relevant_table_names: set[str] = set()
    if results and results.get("metadatas"):
        for meta_list in results["metadatas"]:
            for meta in meta_list:
                relevant_table_names.add(meta["table_name"])

    # Filter full_schema to relevant tables, preserving order
    schema_map = {t["name"]: t for t in full_schema}
    relevant = [schema_map[name] for name in relevant_table_names if name in schema_map]

    logger.info(
        "RAG retrieved %d relevant tables for session %s: %s",
        len(relevant),
        session_id,
        [t["name"] for t in relevant],
    )
    return relevant


def get_full_schema_cached(session_id: str) -> list[TableSchema]:
    """
    Convenience: extract and return the full schema for a session.
    Results are NOT cached per-call — call embed_schema() at connect time instead.
    """
    session = get_session(session_id)
    return extract_full_schema(session)
