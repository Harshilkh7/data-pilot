# DataPilot

> **Talk to your database in plain English.**

DataPilot is an AI-powered natural-language data analyst that lets users connect a PostgreSQL, MySQL, or SQLite database and ask questions in everyday language. Instead of manually writing SQL, the user asks a question, DataPilot retrieves the relevant schema, generates SQL with Google Gemini, validates it, enforces a safe row limit, executes it through a read-only database engine, and returns the result as a table, concise explanation, and optional chart suggestion.

**Live application:** https://datapilot-frontend-ojbo.onrender.com  
**Backend API:** https://datapilot-api-7a8n.onrender.com  
**Repository:** https://github.com/Harshilkh7/data-pilot

---

## Why DataPilot?

Traditional analytics tools often require users to:

1. Understand the database schema.
2. Know SQL.
3. Write joins and aggregations manually.
4. Debug SQL errors.
5. Interpret raw query results.

DataPilot removes that friction.

A user can ask:

> "What were the top 10 products by revenue?"

and receive:

- the generated SQL,
- the query result,
- a natural-language summary,
- and a chart suggestion when the result is suitable for visualization.

The goal is not to hide SQL completely. DataPilot exposes the generated SQL so users can understand, verify, and reuse what the system generated.

---

# Core Features

- **Natural-language to SQL**
- **PostgreSQL, MySQL, and SQLite support**
- **Credential-free e-commerce demo**
- **Automatic database schema inspection**
- **Schema-aware SQL generation**
- **Semantic schema retrieval with RAG**
- **Gemini-powered SQL generation and result summarization**
- **SQL validation with sqlglot**
- **SELECT-only execution**
- **Automatic query row limits**
- **Dedicated read-only execution engine support**
- **Automatic SQL correction after validation/database errors**
- **Result tables**
- **Automatic chart suggestions**
- **Responsive React UI**
- **Hosted on Render**
- **Session recovery for the hosted demo**

---

# Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         React + Vite Frontend                       │
│                                                                     │
│  Connection Screen  ──→  Analytics Workspace  ──→  Results/Charts │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP / JSON
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FastAPI Backend                              │
│                                                                     │
│  /api/connect       /api/demo-connect       /api/query             │
│         │                    │                    │                  │
│         └────────────────────┴────────────────────┘                  │
│                              │                                      │
│                              ▼                                      │
│                     Session + DB Manager                            │
│                              │                                      │
│                              ▼                                      │
│                    Schema Extraction / RAG                          │
│                              │                                      │
│                              ▼                                      │
│                       LangGraph Agent                               │
│                              │                                      │
│            ┌─────────────────┼──────────────────┐                   │
│            ▼                 ▼                  ▼                   │
│       Gemini SQL        sqlglot validation   SQL execution           │
│            │                 │                  │                   │
│            └──────────── retry/correction ─────┘                   │
│                              │                                      │
│                              ▼                                      │
│                    Gemini result summary                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
                   PostgreSQL / MySQL / SQLite
```

---

# End-to-End Workflow

DataPilot processes a query through several controlled stages.

## 1. Connect to a database

The user can either:

- enter a full SQLAlchemy connection string, or
- provide database type, host, port, database name, username, and password.

Supported database types:

- PostgreSQL
- MySQL
- SQLite

For the hosted demo, no credentials are required. The **Try Demo** button connects to a deterministic e-commerce SQLite database.

---

## 2. Create an application session

After a successful connection, the backend creates a UUID session.

The session contains runtime information such as:

- SQLAlchemy engine
- read-only engine
- database type
- database name
- discovered table names

Database credentials are not persisted to disk.

The current session store is intentionally in-memory:

```python
SESSION_STORE: dict[str, SessionData] = {}
```

This means custom sessions disappear when the backend process restarts. The hosted demo can safely reconnect automatically because its database requires no user credentials.

---

## 3. Inspect the database schema

DataPilot uses SQLAlchemy's inspector to discover:

- tables
- columns
- data types
- primary keys
- foreign keys

For example:

```text
orders
├── order_id          INTEGER PK
├── customer_id       INTEGER FK → customers.customer_id
├── order_date        TEXT
├── status            TEXT
├── subtotal           REAL
├── discount           REAL
└── total_amount       REAL

order_items
├── order_item_id     INTEGER PK
├── order_id          INTEGER FK → orders.order_id
├── product_id        INTEGER FK → products.product_id
├── quantity          INTEGER
└── item_total        REAL
```

The schema is then available to the query pipeline.

---

# RAG / Schema Retrieval

Large databases can contain hundreds or thousands of tables. Sending the entire schema to the LLM for every question is inefficient and increases prompt size.

DataPilot therefore includes a schema-retrieval layer.

## How it works

### Step 1 — Describe tables

Each table is converted into a compact natural-language description containing:

- table name
- columns
- data types
- primary keys
- foreign keys

### Step 2 — Generate embeddings

The table descriptions are embedded using Google's Gemini embedding model.

### Step 3 — Store embeddings

Embeddings are stored in an in-process ChromaDB collection associated with the session.

### Step 4 — Retrieve relevant tables

When the user asks a question, the question is embedded and compared with the schema embeddings.

The most relevant tables are selected.

### Small-database optimization

If the database contains at most `RAG_SKIP_THRESHOLD` tables, DataPilot skips semantic retrieval and sends the full schema to the agent. This avoids unnecessary embedding work for small databases.

---

# AI Query Pipeline

The core query workflow is implemented as a LangGraph state graph.

```text
                 ┌─────────────────┐
                 │ retrieve_schema │
                 └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │  generate_sql   │◄──────────────┐
                 └────────┬────────┘               │
                          ▼                        │
                 ┌─────────────────┐               │
                 │  validate_sql   │───────────────┤
                 └────────┬────────┘               │
                          ▼                        │
                 ┌─────────────────┐               │
                 │  limit_inject   │               │
                 └────────┬────────┘               │
                          ▼                        │
                 ┌─────────────────┐               │
                 │   execute_sql   │───────────────┤
                 └────────┬────────┘               │
                          ▼                        │
                 ┌────────────────────┐             │
                 │ summarize_results  │             │
                 └─────────┬──────────┘             │
                           ▼                        │
                          END                       │
                                                     │
                    validation / DB errors ──────────┘
```

## Stage 1 — Schema retrieval

The question is used to identify the relevant database tables.

Example:

```text
Question:
"Which product category generated the most revenue?"
```

Relevant tables might include:

```text
categories
products
order_items
orders
```

---

## Stage 2 — SQL generation

Gemini receives:

- the user's question,
- the relevant schema,
- primary-key information,
- foreign-key relationships,
- SQL generation rules,
- and any error from a previous attempt.

The model is instructed to output only a SQL query.

Example:

```sql
SELECT
    c.category_name,
    SUM(oi.item_total) AS revenue
FROM categories c
JOIN products p ON p.category_id = c.category_id
JOIN order_items oi ON oi.product_id = p.product_id
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status != 'cancelled'
GROUP BY c.category_name
ORDER BY revenue DESC
LIMIT 1;
```

---

# SQL Safety Layer

AI-generated SQL should never be executed blindly.

DataPilot therefore validates every generated query before execution.

## sqlglot parsing

The generated SQL is parsed using **sqlglot**.

The system rejects statements that are not SELECT statements.

Forbidden operations include:

```text
INSERT
UPDATE
DELETE
DROP
ALTER
CREATE
TRUNCATE
REPLACE
MERGE
UPSERT
GRANT
REVOKE
```

This gives the AI an explicit read-only boundary.

---

## Automatic row limits

DataPilot also prevents completely unbounded result sets.

Default behavior:

```text
Normal query       → maximum 500 rows
"all/every/export" → maximum 10,000 rows
```

If Gemini generates:

```sql
SELECT * FROM orders;
```

DataPilot can transform it into:

```sql
SELECT * FROM orders LIMIT 500;
```

The API also returns a human-readable `limit_note` explaining when the system applied a limit.

---

# Self-Correction Loop

The query pipeline can recover from common AI-generated SQL errors.

For example:

```text
Gemini generates SQL
       ↓
sqlglot validation
       ↓
invalid SQL
       ↓
error added to agent state
       ↓
Gemini receives the error
       ↓
new SQL generated
       ↓
validation again
```

The same pattern applies to database execution errors.

The number of agent attempts is controlled by:

```env
MAX_AGENT_ATTEMPTS=3
```

This makes the pipeline more robust than a simple one-shot LLM → SQL implementation.

---

# Query Execution

Once SQL passes validation and row-limit enforcement, it is executed using the session's read-only engine.

The execution layer:

1. retrieves the active session,
2. opens a database connection,
3. executes the SQL,
4. converts results into a pandas DataFrame,
5. normalizes null values,
6. extracts columns and rows,
7. returns structured JSON.

For production systems, DataPilot supports a separate:

```env
READ_ONLY_DATABASE_URL=...
READ_ONLY_MODE=true
```

This allows schema inspection and query execution to use separate database credentials.

**Recommended production setup:** use a dedicated database account with SELECT-only permissions.

---

# Result Summarization

After SQL execution, Gemini receives the question and query results and generates a concise natural-language explanation.

For example:

```text
Question:
"What were the top 5 products by revenue?"

Result:
Wireless Headphones — $18,430
Smart Watch         — $16,920
...

Summary:
"Wireless Headphones generated the highest revenue, followed by
Smart Watch and Mechanical Keyboard."
```

The API returns both the structured result and the explanation.

---

# Chart Suggestions

DataPilot also performs lightweight result-shape analysis.

Depending on the question and returned data, it can suggest:

- bar charts
- line charts
- pie charts

Examples:

```text
"Revenue by category"
        ↓
Bar chart

"Monthly revenue trend"
        ↓
Line chart

"Order distribution by status"
        ↓
Pie chart
```

The backend returns a `chart_suggestion` object when the result is suitable for visualization.

---

# API Flow

## 1. Health Check

```http
GET /api/health
```

Response:

```json
{
  "status": "ok",
  "sessions_active": 1
}
```

---

## 2. Demo Connection

```http
POST /api/demo-connect
```

No credentials are required.

The endpoint:

1. initializes the e-commerce SQLite database if necessary,
2. validates the connection,
3. creates a session,
4. extracts the schema,
5. prepares schema embeddings,
6. returns the schema overview.

Example response:

```json
{
  "session_id": "uuid",
  "database_name": "ecommerce.db",
  "db_type": "sqlite",
  "schema_overview": [
    {
      "table": "customers",
      "row_count": 500
    },
    {
      "table": "orders",
      "row_count": 3000
    }
  ],
  "message": "Demo mode: connected to 'ecommerce.db' (9 tables)."
}
```

---

## 3. Custom Database Connection

```http
POST /api/connect
```

Two connection styles are supported.

### Connection string

```json
{
  "connection_string": "postgresql+psycopg2://user:password@host:5432/database"
}
```

### Structured fields

```json
{
  "db_type": "postgresql",
  "host": "localhost",
  "port": 5432,
  "database": "analytics",
  "username": "readonly_user",
  "password": "..."
}
```

---

## 4. Natural-Language Query

```http
POST /api/query
```

Request:

```json
{
  "session_id": "uuid",
  "question": "What are the top 10 products by revenue?"
}
```

Response contains:

```json
{
  "sql": "SELECT ...",
  "summary": "The top product is ...",
  "columns": ["product_name", "revenue"],
  "rows": [
    ["Wireless Headphones 1", 18430.25]
  ],
  "row_count": 10,
  "truncated": false,
  "limit_note": "",
  "chart_suggestion": {
    "type": "bar",
    "x": "product_name",
    "y": "revenue"
  },
  "error": null,
  "elapsed_ms": 1842.4
}
```

---

## 5. Disconnect

```http
DELETE /api/session/{session_id}
```

This disposes the SQLAlchemy engines associated with the session and removes the session from memory.

---

# Demo E-Commerce Database

The hosted demo now uses a realistic e-commerce schema instead of the original Chinook music database.

## Tables

```text
customers
    │
    └───────────────┐
                    ▼
                  orders
                    │
                    ├──────────────► payments
                    │
                    ├──────────────► shipments
                    │
                    ▼
               order_items
                    │
                    ▼
                 products
                 /      \
                ▼        ▼
          categories    sellers

customers ─────────────► reviews ◄──────── products
```

### customers

Stores customer identity and location information.

### sellers

Stores marketplace sellers and seller ratings.

### categories

Product category information.

### products

Stores:

- product name
- category
- seller
- price
- cost
- inventory
- creation date

### orders

Stores:

- customer
- order date
- order status
- shipping location
- subtotal
- shipping fee
- discount
- final amount

### order_items

Stores individual products purchased in each order.

### payments

Stores payment method, payment status, date, and amount.

### reviews

Stores product ratings and review text.

### shipments

Stores carrier, shipping status, shipped date, and delivery date.

---

# Demo Dataset Size

The deterministic hosted dataset contains approximately:

```text
Customers       500
Sellers           6
Categories        6
Products        100
Orders        3,000
Order Items   9,000+
Payments      3,000
Reviews       1,600
Shipments     3,000
```

The dataset is seeded deterministically so the demo remains reproducible.

---

# Example Questions

Once connected to the e-commerce demo, try:

### Revenue

```text
What is the total revenue?
```

```text
What were the top 10 products by revenue?
```

```text
Show monthly revenue for 2026.
```

### Customers

```text
Who are the top 10 customers by total spending?
```

```text
Which city has the most customers?
```

```text
How many customers have never placed an order?
```

### Products

```text
Which category generated the most revenue?
```

```text
Which products have the highest average rating?
```

```text
Show products with less than 20 units in stock.
```

### Orders

```text
What percentage of orders were cancelled?
```

```text
Show the order count by status.
```

```text
What is the average order value?
```

### Payments

```text
Which payment method is used most often?
```

### Shipping

```text
What is the average delivery time by carrier?
```

### Reviews

```text
Which products have the highest average rating with at least 10 reviews?
```

---

# Project Structure

```text
data-pilot/
│
├── backend/
│   ├── agent.py              # LangGraph NL → SQL agent
│   ├── config.py             # Environment/configuration
│   ├── database.py           # DB connections and sessions
│   ├── demo_db.py            # Deterministic e-commerce demo DB
│   ├── main.py               # FastAPI application and API routes
│   ├── rag.py                # Schema extraction + ChromaDB RAG
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ConnectionScreen.tsx
│   │   │   └── QueryInterface.tsx
│   │   ├── api.ts             # Backend API client
│   │   ├── App.tsx
│   │   ├── types.ts
│   │   └── ...
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

---

# Technology Stack

## Frontend

- React
- TypeScript
- Vite
- Axios
- Recharts

## Backend

- Python
- FastAPI
- Uvicorn
- SQLAlchemy
- Pandas
- LangGraph
- ChromaDB
- sqlglot

## AI

- Google Gemini
- Gemini Flash for SQL generation and result summarization
- Gemini embeddings for schema retrieval

## Databases

- PostgreSQL
- MySQL
- SQLite

## Deployment

- Render
- GitHub

---

# Environment Variables

## Backend

Create `.env` in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key

# Optional
GEMINI_MODEL=gemini-3.8-flash
GEMINI_FALLBACK_MODELS=gemini-3.7-flash,gemini-3.6-flash

# Optional custom/demo database
DATABASE_URL=sqlite:///./ecommerce.db

# Optional production read-only connection
READ_ONLY_DATABASE_URL=
READ_ONLY_MODE=false

# Frontend origin
FRONTEND_ORIGIN=http://localhost:5173

# Agent configuration
MAX_AGENT_ATTEMPTS=3
DEFAULT_ROW_LIMIT=500
ALL_ROWS_LIMIT=10000
RAG_TOP_K=5
RAG_SKIP_THRESHOLD=10
```

Never commit real API keys, database passwords, or connection strings.

---

# Local Development

## Prerequisites

- Python 3.11+
- Node.js 18+
- npm
- A Google Gemini API key

---

## 1. Clone the repository

```bash
git clone https://github.com/Harshilkh7/data-pilot.git
cd data-pilot
```

---

## 2. Configure the backend

Create a `.env` file and add:

```env
GEMINI_API_KEY=your_key_here
DATABASE_URL=sqlite:///./ecommerce.db
```

---

## 3. Install backend dependencies

```bash
cd backend
pip install -r requirements.txt
```

---

## 4. Start the backend

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at:

```text
http://localhost:8000
```

FastAPI's interactive documentation is available at:

```text
http://localhost:8000/docs
```

---

## 5. Start the frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

---

# Production Deployment

The current hosted setup uses Render.

## Backend

The FastAPI service uses:

```text
Build:
pip install -r backend/requirements.txt

Start:
cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT
```

Required environment variables:

```text
GEMINI_API_KEY
GEMINI_MODEL
GEMINI_FALLBACK_MODELS
DATABASE_URL
FRONTEND_ORIGIN
```

## Frontend

The static frontend uses:

```text
Build:
cd frontend && npm install && npm run build

Publish directory:
frontend/dist
```

Frontend environment:

```env
VITE_API_URL=https://datapilot-api-7a8n.onrender.com
```

---

# API Request Flow

A typical query travels through the system like this:

```text
User
 │
 │ "What were the top 10 products by revenue?"
 ▼
React QueryInterface
 │
 │ POST /api/query
 ▼
FastAPI
 │
 │ session_id validation
 ▼
LangGraph
 │
 ├── Retrieve schema
 │       │
 │       └── ChromaDB / Gemini embeddings
 │
 ├── Generate SQL
 │       │
 │       └── Gemini
 │
 ├── Validate SQL
 │       │
 │       └── sqlglot
 │
 ├── Enforce LIMIT
 │
 ├── Execute
 │       │
 │       └── Read-only SQLAlchemy engine
 │
 └── Summarize
         │
         └── Gemini
 │
 ▼
FastAPI JSON response
 │
 ▼
React
 │
 ├── SQL viewer
 ├── Result table
 ├── Summary
 └── Chart
```

---

# Security Model

DataPilot treats AI-generated SQL as untrusted input.

## Current protections

### 1. SELECT-only validation

Non-SELECT statements are rejected.

### 2. SQL parsing

sqlglot parses generated SQL before execution.

### 3. Row limits

Unbounded result sets are capped.

### 4. Read-only execution

A separate read-only database connection can be configured.

### 5. No credential persistence

User-provided database credentials are held only in the runtime session and are not written to disk.

### 6. CORS

The API explicitly controls which frontend origins can access the backend.

---

# Important Production Considerations

The current project is designed as a portfolio/demo-grade application, but the architecture can be extended for production.

Recommended future improvements:

- Persistent session metadata with encrypted credential storage or an external secrets manager.
- Dedicated read-only database roles for every connected database.
- Redis-backed session management.
- Authentication and authorization.
- Per-user database connection isolation.
- Query timeouts.
- Database-level statement timeouts.
- Rate limiting.
- Audit logging.
- Persistent schema-embedding storage.
- Background embedding jobs for very large schemas.
- Streaming query progress.
- More advanced SQL AST validation.
- Query result caching.
- Usage and token-cost tracking.
- Workspace/team support.

---

# Design Decisions

## Why LangGraph?

The query pipeline is not a single LLM call.

It has distinct states:

```text
retrieve → generate → validate → limit → execute → summarize
```

LangGraph makes these states explicit and allows the system to route failed validation or execution back to SQL generation for self-correction.

## Why sqlglot?

Generating SQL with an LLM does not guarantee that the SQL is safe or syntactically valid.

sqlglot provides an AST-based parsing layer before the query reaches the database.

## Why ChromaDB?

A database can have many tables. Semantic retrieval allows the system to provide only the most relevant schema to Gemini instead of sending the complete schema every time.

## Why SQLAlchemy?

SQLAlchemy provides a common database abstraction for PostgreSQL, MySQL, and SQLite while also exposing schema inspection through its inspector API.

## Why a separate read-only engine?

Schema inspection may require broader database privileges than query execution.

Keeping query execution on a dedicated read-only connection provides an additional defense boundary.

---

# Limitations

- Custom database sessions are currently stored in memory.
- Restarting the backend invalidates custom sessions.
- Gemini availability and latency depend on the upstream API.
- Generated SQL is constrained by the quality and completeness of the database schema.
- Complex vendor-specific SQL features may require additional dialect handling.
- The hosted demo is intentionally bounded by row limits and a small dataset.

---

# Roadmap

- [ ] User authentication
- [ ] Persistent encrypted connection profiles
- [ ] PostgreSQL demo database
- [ ] Larger benchmark dataset
- [ ] Query history
- [ ] Saved dashboards
- [ ] Follow-up questions with conversational context
- [ ] SQL editing before execution
- [ ] Export results to CSV
- [ ] Advanced visualization selection
- [ ] Query performance monitoring
- [ ] Redis-backed sessions
- [ ] Team workspaces
- [ ] Usage analytics
- [ ] Production-grade audit logs

---

# Example Product Flow

A complete DataPilot interaction looks like:

```text
1. User opens DataPilot
             ↓
2. Clicks "Try Demo"
             ↓
3. Backend creates e-commerce SQLite database
             ↓
4. Schema is inspected
             ↓
5. Tables are embedded into ChromaDB
             ↓
6. User asks:
   "Which category generated the most revenue?"
             ↓
7. Relevant schema is retrieved
             ↓
8. Gemini generates SQL
             ↓
9. sqlglot validates the SQL
             ↓
10. DataPilot applies a safe LIMIT
             ↓
11. Query runs through the read-only engine
             ↓
12. Gemini summarizes the result
             ↓
13. Frontend displays:
      • Summary
      • Generated SQL
      • Data table
      • Chart
```

---

# Author

**Harshil Khandelwal**

B.Tech — MANIT Bhopal

GitHub: https://github.com/Harshilkh7

---

## License

Add the project's preferred license here before distributing the repository publicly.
