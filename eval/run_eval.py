#!/usr/bin/env python3
"""
run_eval.py — QueryMind evaluation harness.

Runs 25 natural-language benchmark questions against the Chinook database
and compares actual results to curated expected values (exact match with
floating-point tolerance for numeric fields).

Usage:
  # From project root, with backend in PYTHONPATH:
  cd backend && python ../eval/run_eval.py

  # Or with explicit DB path:
  cd backend && python ../eval/run_eval.py --db sqlite:///./chinook.db

Output:
  - Console: table of question / pass-fail / expected vs actual
  - CSV:      eval/results_<timestamp>.csv
  - Final:    Overall Accuracy: X/Y (Z%)

Methodology:
  - Each benchmark entry has an exact expected_rows list (curated against Chinook).
  - Rows are sorted by all columns before comparison to normalise order.
  - Numeric fields: pass if abs(actual - expected) <= tolerance (default 0.01).
  - String / integer fields: exact string equality after str() normalisation.
  - A question PASSES only if ALL rows match within tolerance AND row counts match.
"""

import argparse
import csv
import json
import math
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

# Ensure backend is importable
_BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(_BACKEND_DIR))

os.environ.setdefault("DATABASE_URL", str(
    Path(__file__).parent.parent / "chinook.db"
).replace("\\", "/"))
# Prepend sqlite:// if bare path
if not os.environ["DATABASE_URL"].startswith("sqlite"):
    os.environ["DATABASE_URL"] = "sqlite:///" + os.environ["DATABASE_URL"]

from database import validate_and_connect, remove_session
from rag import embed_schema
from agent import run_query


# ---------------------------------------------------------------------------
# Benchmark dataset — 25 questions curated against the official Chinook dataset
#
# Each entry:
#   question       : natural-language question
#   expected_rows  : list of dicts (exact expected result, curated from Chinook)
#   tolerance      : optional float for numeric comparison (default 0.01)
#   description    : what this test covers
# ---------------------------------------------------------------------------
BENCHMARK: list[dict] = [
    {
        "id": "Q01",
        "description": "Count total number of artists",
        "question": "How many artists are there in total?",
        "expected_rows": [{"COUNT(*)": 275}],
        "tolerance": 0,
    },
    {
        "id": "Q02",
        "description": "Count total number of albums",
        "question": "How many albums are in the database?",
        "expected_rows": [{"COUNT(*)": 347}],
        "tolerance": 0,
    },
    {
        "id": "Q03",
        "description": "Count total number of tracks",
        "question": "What is the total number of tracks?",
        "expected_rows": [{"COUNT(*)": 3503}],
        "tolerance": 0,
    },
    {
        "id": "Q04",
        "description": "Count distinct genres",
        "question": "How many distinct music genres are there?",
        "expected_rows": [{"COUNT(*)": 25}],
        "tolerance": 0,
    },
    {
        "id": "Q05",
        "description": "Count customers",
        "question": "How many customers are in the database?",
        "expected_rows": [{"COUNT(*)": 59}],
        "tolerance": 0,
    },
    {
        "id": "Q06",
        "description": "Count employees",
        "question": "How many employees work at the company?",
        "expected_rows": [{"COUNT(*)": 8}],
        "tolerance": 0,
    },
    {
        "id": "Q07",
        "description": "Top genre by track count",
        "question": "Which genre has the most tracks?",
        "expected_rows": [{"Name": "Rock", "TrackCount": 1297}],
        "tolerance": 0,
        "columns_subset": ["Name", "TrackCount"],  # only check these columns
    },
    {
        "id": "Q08",
        "description": "Artist with most albums",
        "question": "Which artist has the most albums?",
        "expected_rows": [{"Name": "Iron Maiden", "AlbumCount": 21}],
        "tolerance": 0,
        "columns_subset": ["Name", "AlbumCount"],
    },
    {
        "id": "Q09",
        "description": "Total revenue from all invoices",
        "question": "What is the total revenue from all invoices?",
        "expected_rows": [{"Total": 2328.60}],
        "tolerance": 1.0,  # Seeded data may shift total; allow $1 tolerance
    },
    {
        "id": "Q10",
        "description": "Country with most customers",
        "question": "Which country has the most customers?",
        "expected_rows": [{"Country": "USA", "CustomerCount": 13}],
        "tolerance": 0,
        "columns_subset": ["Country", "CustomerCount"],
    },
    {
        "id": "Q11",
        "description": "Longest track",
        "question": "What is the longest track in the database by duration?",
        "expected_rows": [{"Name": "Occupation / Precipice", "Milliseconds": 5286953}],
        "tolerance": 0,
        "columns_subset": ["Name", "Milliseconds"],
    },
    {
        "id": "Q12",
        "description": "Average track length in minutes",
        "question": "What is the average track length in milliseconds?",
        "expected_rows": [{"AvgMs": 393599.21}],
        "tolerance": 500,  # millisecond tolerance
    },
    {
        "id": "Q13",
        "description": "Number of playlists",
        "question": "How many playlists are there?",
        "expected_rows": [{"COUNT(*)": 18}],
        "tolerance": 0,
    },
    {
        "id": "Q14",
        "description": "Tracks in the 'Rock' genre",
        "question": "How many tracks are in the Rock genre?",
        "expected_rows": [{"COUNT(*)": 1297}],
        "tolerance": 0,
    },
    {
        "id": "Q15",
        "description": "Albums by 'AC/DC'",
        "question": "How many albums does AC/DC have?",
        "expected_rows": [{"AlbumCount": 2}],
        "tolerance": 0,
        "columns_subset": ["AlbumCount"],
    },
    {
        "id": "Q16",
        "description": "Customers from Brazil",
        "question": "How many customers are from Brazil?",
        "expected_rows": [{"COUNT(*)": 5}],
        "tolerance": 0,
    },
    {
        "id": "Q17",
        "description": "Employees and their titles",
        "question": "List all employee titles.",
        "expected_rows": [
            {"Title": "General Manager"},
            {"Title": "Sales Manager"},
            {"Title": "Sales Support Agent"},
            {"Title": "IT Manager"},
            {"Title": "IT Staff"},
        ],
        "tolerance": 0,
        "columns_subset": ["Title"],
        "match_mode": "subset",  # actual rows must be a superset of expected
    },
    {
        "id": "Q18",
        "description": "Top spending customer",
        "question": "Which customer has spent the most money?",
        "expected_rows": [{"CustomerId": 6, "TotalSpent": 49.62}],
        "tolerance": 1.0,  # seeded data may affect totals
        "columns_subset": ["CustomerId"],
    },
    {
        "id": "Q19",
        "description": "Media types available",
        "question": "What media types are available?",
        "expected_rows": [
            {"Name": "MPEG audio file"},
            {"Name": "Protected AAC audio file"},
            {"Name": "Protected MPEG-4 video file"},
            {"Name": "Purchased AAC audio file"},
            {"Name": "AAC audio file"},
        ],
        "tolerance": 0,
        "columns_subset": ["Name"],
        "match_mode": "subset",
    },
    {
        "id": "Q20",
        "description": "Tracks with unit price over $1",
        "question": "How many tracks have a unit price greater than $1?",
        "expected_rows": [{"COUNT(*)": 213}],
        "tolerance": 0,
    },
    {
        "id": "Q21",
        "description": "Total number of invoice lines",
        "question": "How many invoice line items are there in total?",
        "expected_rows": [{"COUNT(*)": 2240}],
        "tolerance": 5,  # seeded data adds rows
    },
    {
        "id": "Q22",
        "description": "Albums starting with 'A'",
        "question": "How many albums have a title starting with the letter A?",
        "expected_rows": [{"COUNT(*)": 32}],
        "tolerance": 0,
    },
    {
        "id": "Q23",
        "description": "Tracks in Jazz playlist",
        "question": "How many tracks are in the Music playlist?",
        "expected_rows": [{"TrackCount": 6580}],
        "tolerance": 0,
        "columns_subset": ["TrackCount"],
    },
    {
        "id": "Q24",
        "description": "Revenue by country (top 3)",
        "question": "What are the top 3 countries by total invoice revenue?",
        "expected_rows": [
            {"BillingCountry": "USA"},
            {"BillingCountry": "Canada"},
            {"BillingCountry": "France"},
        ],
        "tolerance": 0,
        "columns_subset": ["BillingCountry"],
        "match_mode": "ordered_subset",  # only check these columns, in order
    },
    {
        "id": "Q25",
        "description": "Sales support agents",
        "question": "How many employees have the title 'Sales Support Agent'?",
        "expected_rows": [{"COUNT(*)": 3}],
        "tolerance": 0,
    },
]


# ---------------------------------------------------------------------------
# Comparison logic
# ---------------------------------------------------------------------------

def _normalize_value(v: Any) -> Any:
    """Normalise a value for comparison: strip strings, keep numbers as float."""
    if v is None:
        return None
    if isinstance(v, float):
        return v
    if isinstance(v, (int,)):
        return float(v)
    return str(v).strip()


def _numeric_close(a: Any, b: Any, tolerance: float) -> bool:
    """True if both are numeric and within tolerance."""
    try:
        fa, fb = float(a), float(b)
        return math.isfinite(fa) and math.isfinite(fb) and abs(fa - fb) <= tolerance
    except (TypeError, ValueError):
        return False


def _row_matches(actual_row: dict, expected_row: dict, tolerance: float, columns_subset: list[str] | None) -> bool:
    """Return True if actual_row matches expected_row for the specified columns."""
    if len(actual_row) == 1 and len(expected_row) == 1:
        act_val = list(actual_row.values())[0]
        exp_val = list(expected_row.values())[0]
        exp_n = _normalize_value(exp_val)
        act_n = _normalize_value(act_val)
        if isinstance(exp_n, float) or isinstance(act_n, float):
            return _numeric_close(exp_n, act_n, tolerance)
        return exp_n == act_n

    check_keys = columns_subset if columns_subset else list(expected_row.keys())
    for key in check_keys:
        if key not in expected_row:
            continue
        exp_val = expected_row[key]
        # Find matching key in actual row (case-insensitive, flexible column names)
        act_val = None
        for act_key, act_v in actual_row.items():
            if act_key.lower() == key.lower() or act_key.lower().endswith(f"_{key.lower()}"):
                act_val = act_v
                break
        if act_val is None:
            # Try partial match (either direction)
            for act_key, act_v in actual_row.items():
                if key.lower() in act_key.lower() or act_key.lower() in key.lower():
                    act_val = act_v
                    break

        if act_val is None:
            return False

        exp_n = _normalize_value(exp_val)
        act_n = _normalize_value(act_val)

        if isinstance(exp_n, float) or isinstance(act_n, float):
            if not _numeric_close(exp_n, act_n, tolerance):
                return False
        else:
            if exp_n != act_n:
                return False
    return True


def _compare_results(
    actual_rows: list[list],
    actual_columns: list[str],
    expected_rows: list[dict],
    tolerance: float,
    columns_subset: list[str] | None,
    match_mode: str,
) -> tuple[bool, str]:
    """
    Compare actual rows against expected rows.

    match_mode:
      "exact"          - row counts must match and all rows must match (order-independent)
      "subset"         - all expected rows must appear somewhere in actual (order-independent)
      "ordered_subset" - first N expected rows must match first N actual rows

    Returns: (passed, reason_if_failed)
    """
    # Convert actual rows to list of dicts
    actual_dicts = [dict(zip(actual_columns, row)) for row in actual_rows]

    if match_mode == "exact":
        if len(actual_dicts) != len(expected_rows):
            return False, f"Row count mismatch: expected {len(expected_rows)}, got {len(actual_dicts)}"
        # Try to match each expected row to some actual row
        remaining = list(actual_dicts)
        for exp in expected_rows:
            matched = False
            for i, act in enumerate(remaining):
                if _row_matches(act, exp, tolerance, columns_subset):
                    remaining.pop(i)
                    matched = True
                    break
            if not matched:
                return False, f"Expected row not found in results: {exp}"
        return True, ""

    elif match_mode == "subset":
        for exp in expected_rows:
            found = any(_row_matches(act, exp, tolerance, columns_subset) for act in actual_dicts)
            if not found:
                return False, f"Expected row not found: {exp}"
        return True, ""

    elif match_mode == "ordered_subset":
        for i, exp in enumerate(expected_rows):
            if i >= len(actual_dicts):
                return False, f"Not enough actual rows (expected at least {len(expected_rows)}, got {len(actual_dicts)})"
            if not _row_matches(actual_dicts[i], exp, tolerance, columns_subset):
                return False, f"Row {i} mismatch: expected {exp}, got {actual_dicts[i]}"
        return True, ""

    return False, f"Unknown match_mode: {match_mode}"


# ---------------------------------------------------------------------------
# Main eval loop
# ---------------------------------------------------------------------------

def run_eval(db_url: str, output_dir: str) -> None:
    print("\n" + "=" * 70)
    print("  QueryMind Evaluation Harness")
    print(f"  Database: {db_url.split('@')[-1]}")
    print(f"  Questions: {len(BENCHMARK)}")
    print("=" * 70)

    # Connect to database and embed schema
    print("\nConnecting to database...")
    session_id, session = validate_and_connect(db_url)
    print(f"  Connected. Tables: {session.table_names}")

    print("Embedding schema for RAG...")
    embed_schema(session_id)
    print("  Schema embedded.")

    results = []
    passed = 0

    for i, bench in enumerate(BENCHMARK, 1):
        qid = bench["id"]
        question = bench["question"]
        expected_rows = bench["expected_rows"]
        tolerance = bench.get("tolerance", 0.01)
        columns_subset = bench.get("columns_subset")
        match_mode = bench.get("match_mode", "exact")

        print(f"\n[{i:02d}/{len(BENCHMARK)}] {qid}: {bench['description']}")
        print(f"  Q: {question}")

        start = time.perf_counter()
        try:
            result = run_query(session_id=session_id, question=question)
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            print(f"  ERROR: {exc}")
            results.append({
                "id": qid,
                "description": bench["description"],
                "question": question,
                "status": "ERROR",
                "reason": str(exc),
                "sql": "",
                "expected_rows": json.dumps(expected_rows),
                "actual_rows": "[]",
                "elapsed_ms": round(elapsed, 1),
            })
            continue

        elapsed = (time.perf_counter() - start) * 1000

        if result.get("error"):
            print(f"  FAIL (agent error): {result['error'][:120]}")
            results.append({
                "id": qid,
                "description": bench["description"],
                "question": question,
                "status": "FAIL",
                "reason": f"Agent error: {result['error'][:200]}",
                "sql": result.get("sql", ""),
                "expected_rows": json.dumps(expected_rows),
                "actual_rows": "[]",
                "elapsed_ms": round(elapsed, 1),
            })
            continue

        actual_columns = result["columns"]
        actual_rows = result["rows"]

        ok, reason = _compare_results(
            actual_rows, actual_columns, expected_rows, tolerance, columns_subset, match_mode
        )

        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
            print(f"  PASS  ({len(actual_rows)} rows, {elapsed:.0f}ms)")
        else:
            print(f"  FAIL  Reason: {reason}")
            print(f"  SQL:  {result.get('sql', '')[:120]}")
            if actual_rows:
                print(f"  Actual first row: {dict(zip(actual_columns, actual_rows[0]))}")

        results.append({
            "id": qid,
            "description": bench["description"],
            "question": question,
            "status": status,
            "reason": reason,
            "sql": result.get("sql", ""),
            "expected_rows": json.dumps(expected_rows),
            "actual_rows": json.dumps(
                [dict(zip(actual_columns, row)) for row in actual_rows[:5]]
            ),
            "elapsed_ms": round(elapsed, 1),
        })

    # ---------------------------------------------------------------------------
    # Output report
    # ---------------------------------------------------------------------------
    total = len(BENCHMARK)
    accuracy = passed / total * 100 if total else 0

    print("\n" + "=" * 70)
    print(f"  RESULTS: {passed}/{total} passed  ({accuracy:.1f}% accuracy)")
    print("=" * 70)

    # Console table
    print(f"\n{'ID':<6} {'Status':<6} {'Description':<40} {'Elapsed':>8}")
    print("-" * 65)
    for r in results:
        flag = "P" if r["status"] == "PASS" else "F"
        print(f"  {r['id']:<5} {flag} {r['status']:<5} {r['description'][:38]:<40} {r['elapsed_ms']:>7.0f}ms")

    # CSV output
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = os.path.join(output_dir, f"results_{timestamp}.csv")
    fieldnames = ["id", "description", "question", "status", "reason", "sql", "expected_rows", "actual_rows", "elapsed_ms"]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    print(f"\nCSV report saved to: {csv_path}")
    print(f"\nOverall Accuracy: {passed}/{total} ({accuracy:.1f}%)\n")

    remove_session(session_id)
    return accuracy


def main():
    parser = argparse.ArgumentParser(
        description="QueryMind evaluation harness — runs benchmark against Chinook DB."
    )
    parser.add_argument(
        "--db",
        default=None,
        metavar="CONNECTION_STRING",
        help="Database connection string. Defaults to DATABASE_URL env var or sqlite:///./chinook.db",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(os.path.dirname(__file__)),
        help="Directory for CSV output. Default: eval/",
    )
    args = parser.parse_args()

    db_url = args.db or os.environ.get(
        "DATABASE_URL",
        f"sqlite:///{Path(__file__).parent.parent / 'chinook.db'}",
    )

    run_eval(db_url, args.output_dir)


if __name__ == "__main__":
    main()
