#!/usr/bin/env python3
"""
setup_chinook.py — Download and set up the Chinook sample database.

Usage:
  # SQLite (default, for local dev)
  python scripts/setup_chinook.py

  # PostgreSQL (for Supabase / Neon)
  python scripts/setup_chinook.py --postgres postgresql://user:pass@host:5432/dbname

The Chinook database is a sample digital-media store schema with 11 tables:
  Artist, Album, Track, Genre, MediaType, Playlist, PlaylistTrack,
  Employee, Customer, Invoice, InvoiceLine

SQLite file is placed at: ./chinook.db (project root)
"""

import argparse
import os
import sys
import urllib.request
import zipfile
import io
import sqlite3
import tempfile

# Chinook SQLite pre-built database (binary .db file) from lerocha/chinook-database
CHINOOK_SQLITE_URL = (
    "https://github.com/lerocha/chinook-database/raw/master/ChinookDatabase/DataSources/Chinook_Sqlite.sqlite"
)

# Chinook PostgreSQL SQL script (for Supabase / Neon setup)
CHINOOK_POSTGRES_URL = (
    "https://github.com/lerocha/chinook-database/raw/master/ChinookDatabase/DataSources/Chinook_PostgreSql.sql"
)

DEFAULT_SQLITE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chinook.db")


def download_sqlite(dest_path: str) -> None:
    print(f"Downloading Chinook SQLite database from GitHub...")
    print(f"  URL: {CHINOOK_SQLITE_URL}")

    with urllib.request.urlopen(CHINOOK_SQLITE_URL) as response:
        data = response.read()

    with open(dest_path, "wb") as f:
        f.write(data)

    print(f"  Saved to: {dest_path}")

    # Verify the database is readable
    conn = sqlite3.connect(dest_path)
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    conn.close()

    print(f"  Tables found: {', '.join(tables)}")
    print(f"\nChinook SQLite setup complete!")
    print(f"Add to your .env file:")
    print(f"  DATABASE_URL=sqlite:///{dest_path}")


def download_postgres_script(pg_url: str) -> None:
    print(f"Downloading Chinook PostgreSQL SQL script...")
    print(f"  URL: {CHINOOK_POSTGRES_URL}")

    with urllib.request.urlopen(CHINOOK_POSTGRES_URL) as response:
        sql_content = response.read().decode("utf-8")

    # Save locally for reference
    script_path = os.path.join(os.path.dirname(__file__), "chinook_postgres.sql")
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(sql_content)
    print(f"  Script saved to: {script_path}")

    # Apply to the target Postgres database
    print(f"\nApplying Chinook schema to: {pg_url.split('@')[-1]}")
    print("  (credentials hidden)")

    try:
        import sqlalchemy
        from sqlalchemy import create_engine, text

        engine = create_engine(pg_url)
        with engine.connect() as conn:
            # Execute the script in chunks (split on GO or statement boundaries)
            for stmt in sql_content.split(";\n"):
                stmt = stmt.strip()
                if stmt and not stmt.startswith("--"):
                    try:
                        conn.execute(text(stmt))
                    except Exception as e:
                        # Some statements may fail if already exists — log and continue
                        print(f"  Warning: {e}")
            conn.commit()
        print(f"\nChinook PostgreSQL setup complete!")
        print(f"Add to your .env file:")
        print(f"  DATABASE_URL={pg_url}")

    except ImportError:
        print("\nSQLAlchemy not installed. To apply manually, run:")
        print(f"  psql {pg_url} -f {script_path}")
    except Exception as exc:
        print(f"\nFailed to apply script automatically: {exc}")
        print(f"Apply manually with:")
        print(f"  psql {pg_url} -f {script_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Set up the Chinook sample database for DataPilot."
    )
    parser.add_argument(
        "--postgres",
        metavar="CONNECTION_STRING",
        help=(
            "PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/dbname). "
            "If omitted, sets up the SQLite version locally."
        ),
    )
    parser.add_argument(
        "--sqlite-path",
        metavar="PATH",
        default=DEFAULT_SQLITE_PATH,
        help=f"Path for the SQLite database file. Default: {DEFAULT_SQLITE_PATH}",
    )
    args = parser.parse_args()

    if args.postgres:
        download_postgres_script(args.postgres)
    else:
        download_sqlite(args.sqlite_path)


if __name__ == "__main__":
    main()
