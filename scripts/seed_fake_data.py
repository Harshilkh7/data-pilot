#!/usr/bin/env python3
"""
seed_fake_data.py — Bulk-insert 100,000+ synthetic rows into Chinook tables.

Inserts into:
  - Invoice      (~50,000 rows)
  - InvoiceLine  (~100,000 rows, 2 per invoice average)

This demonstrates scale/pagination handling, LIMIT injection, and performance
of the QueryMind pipeline on large datasets.

Usage:
  python scripts/seed_fake_data.py
  python scripts/seed_fake_data.py --db postgresql://user:pass@host:5432/dbname
  python scripts/seed_fake_data.py --invoices 10000 --batch-size 500
"""

import argparse
import os
import random
import sys
from datetime import datetime, timedelta

from faker import Faker
from sqlalchemy import create_engine, text, inspect

# Default: local SQLite Chinook
DEFAULT_DB = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{os.path.join(os.path.dirname(os.path.dirname(__file__)), 'chinook.db')}",
)

fake = Faker()
Faker.seed(42)
random.seed(42)


def get_existing_ids(conn, table: str, id_col: str) -> list[int]:
    """Fetch all existing primary key values from a table."""
    result = conn.execute(text(f'SELECT "{id_col}" FROM "{table}"'))
    return [row[0] for row in result.fetchall()]


def get_max_id(conn, table: str, id_col: str) -> int:
    result = conn.execute(text(f'SELECT MAX("{id_col}") FROM "{table}"'))
    val = result.scalar()
    return val if val is not None else 0


def seed_invoices(conn, n_invoices: int, batch_size: int) -> list[int]:
    """Insert synthetic Invoice rows. Returns list of new InvoiceIds."""
    print(f"\nSeeding {n_invoices:,} synthetic Invoice rows...")

    customer_ids = get_existing_ids(conn, "Customer", "CustomerId")
    if not customer_ids:
        print("  ERROR: No customers found. Run setup_chinook.py first.")
        sys.exit(1)

    start_id = get_max_id(conn, "Invoice", "InvoiceId") + 1
    new_invoice_ids = []
    inserted = 0

    for batch_start in range(0, n_invoices, batch_size):
        batch_end = min(batch_start + batch_size, n_invoices)
        rows = []
        for i in range(batch_start, batch_end):
            invoice_id = start_id + i
            customer_id = random.choice(customer_ids)
            invoice_date = fake.date_time_between(
                start_date=datetime(2020, 1, 1),
                end_date=datetime(2024, 12, 31),
            )
            billing_city = fake.city()
            billing_country = fake.country()
            billing_state = fake.state_abbr() if random.random() > 0.3 else None
            billing_address = fake.street_address()
            billing_postal = fake.postcode()
            total = round(random.uniform(0.99, 25.99), 2)

            rows.append({
                "invoice_id": invoice_id,
                "customer_id": customer_id,
                "invoice_date": invoice_date.strftime("%Y-%m-%d %H:%M:%S"),
                "billing_address": billing_address,
                "billing_city": billing_city,
                "billing_state": billing_state,
                "billing_country": billing_country,
                "billing_postal_code": billing_postal,
                "total": total,
            })
            new_invoice_ids.append(invoice_id)

        conn.execute(
            text(
                'INSERT INTO "Invoice" '
                '("InvoiceId","CustomerId","InvoiceDate","BillingAddress","BillingCity",'
                '"BillingState","BillingCountry","BillingPostalCode","Total") VALUES '
                '(:invoice_id,:customer_id,:invoice_date,:billing_address,:billing_city,'
                ':billing_state,:billing_country,:billing_postal_code,:total)'
            ),
            rows,
        )
        conn.commit()
        inserted += len(rows)
        pct = inserted / n_invoices * 100
        print(f"  Invoices: {inserted:,}/{n_invoices:,} ({pct:.1f}%)", end="\r")

    print(f"\n  Done. {inserted:,} Invoice rows inserted.")
    return new_invoice_ids


def seed_invoice_lines(conn, invoice_ids: list[int], batch_size: int) -> None:
    """Insert 1-3 InvoiceLine rows per invoice."""
    print(f"\nSeeding InvoiceLine rows for {len(invoice_ids):,} invoices...")

    track_ids = get_existing_ids(conn, "Track", "TrackId")
    if not track_ids:
        print("  ERROR: No tracks found. Run setup_chinook.py first.")
        sys.exit(1)

    start_id = get_max_id(conn, "InvoiceLine", "InvoiceLineId") + 1
    total_rows = 0
    current_line_id = start_id

    for batch_start in range(0, len(invoice_ids), batch_size):
        batch_invoice_ids = invoice_ids[batch_start:batch_start + batch_size]
        rows = []
        for invoice_id in batch_invoice_ids:
            n_lines = random.randint(1, 3)
            for _ in range(n_lines):
                track_id = random.choice(track_ids)
                unit_price = random.choice([0.99, 1.29, 1.99])
                quantity = random.randint(1, 5)
                rows.append({
                    "invoice_line_id": current_line_id,
                    "invoice_id": invoice_id,
                    "track_id": track_id,
                    "unit_price": unit_price,
                    "quantity": quantity,
                })
                current_line_id += 1

        conn.execute(
            text(
                'INSERT INTO "InvoiceLine" '
                '("InvoiceLineId","InvoiceId","TrackId","UnitPrice","Quantity") VALUES '
                '(:invoice_line_id,:invoice_id,:track_id,:unit_price,:quantity)'
            ),
            rows,
        )
        conn.commit()
        total_rows += len(rows)
        pct = (batch_start + len(batch_invoice_ids)) / len(invoice_ids) * 100
        print(f"  InvoiceLines: {total_rows:,} ({pct:.1f}%)", end="\r")

    print(f"\n  Done. {total_rows:,} InvoiceLine rows inserted.")


def print_summary(conn) -> None:
    print("\n--- Row Count Summary ---")
    for table in ["Invoice", "InvoiceLine", "Customer", "Track"]:
        try:
            result = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"'))
            count = result.scalar()
            print(f"  {table:<20} {count:>10,}")
        except Exception:
            pass
    print("-------------------------")


def main():
    parser = argparse.ArgumentParser(
        description="Seed Chinook database with synthetic data for scale testing."
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB,
        metavar="CONNECTION_STRING",
        help=f"Database connection string. Default: {DEFAULT_DB}",
    )
    parser.add_argument(
        "--invoices",
        type=int,
        default=50_000,
        metavar="N",
        help="Number of synthetic Invoice rows to insert. Default: 50,000",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        metavar="N",
        help="Insert batch size. Default: 1000",
    )
    args = parser.parse_args()

    print(f"QueryMind — Fake Data Seeder")
    print(f"  Target DB  : {args.db.split('@')[-1]}")
    print(f"  Invoices   : {args.invoices:,}")
    print(f"  Batch size : {args.batch_size:,}")

    engine = create_engine(args.db, pool_pre_ping=True)

    # Verify tables exist
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    required = {"Invoice", "InvoiceLine", "Customer", "Track"}
    missing = required - set(tables)
    if missing:
        print(f"\nERROR: Missing required tables: {missing}")
        print("Run 'python scripts/setup_chinook.py' first.")
        sys.exit(1)

    with engine.connect() as conn:
        new_ids = seed_invoices(conn, args.invoices, args.batch_size)
        seed_invoice_lines(conn, new_ids, args.batch_size)
        print_summary(conn)

    print("\nSeeding complete! The database is ready for scale testing.")


if __name__ == "__main__":
    main()
