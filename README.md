# DataPilot — AI-Powered SQL Analytics

DataPilot is a full-stack conversational analytics platform that lets users ask questions about relational databases in plain English and receive safe, executable SQL, structured results, and concise explanations.

**Current stack:** React + JavaScript + Vite on the frontend, Node.js + Express + JavaScript on the backend, Gemini for SQL generation/summarization, and PostgreSQL/MySQL/SQLite database support.

- **Live app:** https://datapilot-frontend-ojbo.onrender.com/
- **Node API:** https://datapilot-api-node.onrender.com/
- **Repository:** https://github.com/Harshilkh7/data-pilot

> The hosted Node API needs `GEMINI_API_KEY` configured in Render before AI queries can run. The API health and demo database endpoints do not require the key.

## Why DataPilot?

Traditional SQL analytics requires users to know table names, joins, filters, grouping, and SQL syntax. DataPilot adds a conversational layer while keeping database execution behind explicit read-only guardrails.

The application is designed around five steps:

1. **Connect** — connect a PostgreSQL, MySQL, or SQLite database, or open the seeded e-commerce demo.
2. **Understand** — inspect tables and columns and select the most relevant schema context for the question.
3. **Generate** — Gemini converts the natural-language request into a single SQL SELECT query.
4. **Protect + Execute** — the query is checked for read-only behavior, bounded with a row limit, then executed against the connected database.
5. **Explain** — results are returned as rows with an optional visualization and a concise natural-language summary.

## Architecture

```text
┌──────────────────── React + JavaScript ────────────────────┐
│ Connection screen → Query workspace → Rows / Visual / SQL │
└───────────────────────────┬────────────────────────────────┘
                            │ HTTP/JSON
                            ▼
┌──────────────────── Node.js + Express ─────────────────────┐
│ /api/connect       /api/demo-connect                       │
│ /api/query         /api/session/:id                        │
│                                                           │
│ Session manager → Schema retrieval → Gemini → Guardrails  │
│                                      ↓                    │
│                              Database execution            │
└───────────────┬──────────────────┬─────────────────────────┘
                │                  │
                ▼                  ▼
        PostgreSQL / MySQL       SQLite
                                  │
                                  ▼
                           E-commerce demo DB
```

## Query pipeline

A query follows this flow:

```text
User question
    ↓
Load active database session
    ↓
Read database schema
    ↓
Generate schema descriptions
    ↓
Gemini Embeddings → ChromaDB semantic retrieval
    ↓
Select relevant tables/columns
    ↓
Gemini generates SQL
    ↓
SELECT-only validation
    ↓
Reject DDL/DML/multiple statements
    ↓
Inject a safe LIMIT
    ↓
Execute against database
    ↓
Build rows + columns
    ↓
Gemini result summary
    ↓
Chart suggestion
    ↓
JSON response → React
```

If SQL generation or execution fails, the backend feeds the error back into the generation step and retries up to `MAX_AGENT_ATTEMPTS`.

## Safety model

DataPilot is intentionally read-only at the application layer.

The query pipeline:

- accepts only SQL beginning with `SELECT`
- rejects common write/DDL keywords such as INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, MERGE, GRANT, and REVOKE
- rejects multiple statements
- applies a default 500-row result cap
- applies a 10,000-row maximum for broad "all/every/export" requests
- supports a separate read-only connection string for production database setups
- keeps user connection sessions in memory rather than persisting credentials to disk

For production deployments, a database account with SELECT-only permissions should still be used. Application-level validation is a second layer, not a replacement for database permissions.

## Database support

### PostgreSQL

Connection example:

```text
postgresql://user:password@host:5432/database
```

### MySQL

Connection example:

```text
mysql://user:password@host:3306/database
```

### SQLite

Connection example:

```text
sqlite:///./analytics.db
```

The backend discovers tables and columns from the connected database and constructs schema context dynamically.

## Demo database

The hosted demo uses a deterministic SQLite e-commerce dataset.

| Entity | Approx. rows |
|---|---:|
| Customers | 500 |
| Sellers | 6 |
| Categories | 6 |
| Products | 100 |
| Orders | 3,000 |
| Order items | 9,000+ |
| Payments | 3,000 |
| Reviews | 1,600 |
| Shipments | 3,000 |

The data covers realistic commerce concepts including products, categories, customers, order totals, payment methods, ratings, shipping carriers, and delivery timestamps.

### Example questions

- Which product generated the most sales?
- Show the 10 highest-spending customers.
- How did monthly revenue change in 2026?
- Which category generated the most revenue?
- What is the average order value?
- Which payment method is used most often?
- Which shipping carrier has the fastest delivery time?
- What percentage of orders were cancelled?
- Which products have the highest average rating?

## API

### Health

```http
GET /api/health
```

### Demo connection

```http
POST /api/demo-connect
```

Returns a temporary session and schema overview.

### Custom connection

```http
POST /api/connect
Content-Type: application/json

{
  "connection_string": "postgresql://user:password@host:5432/database"
}
```

Structured connection fields are also supported:

```json
{
  "db_type": "postgresql",
  "host": "db.example.com",
  "port": 5432,
  "database": "analytics",
  "username": "readonly_user",
  "password": "..."
}
```

### Query

```http
POST /api/query
Content-Type: application/json

{
  "session_id": "session-uuid",
  "question": "What are the top 10 products by revenue?"
}
```

Response shape:

```json
{
  "sql": "SELECT ...",
  "summary": "The top products generated ...",
  "columns": ["product_name", "revenue"],
  "rows": [["Product 1", 12345]],
  "row_count": 10,
  "truncated": false,
  "limit_note": "",
  "chart_suggestion": {
    "type": "bar",
    "x": "product_name",
    "y": "revenue"
  },
  "error": null,
  "elapsed_ms": 842.4
}
```

### Disconnect

```http
DELETE /api/session/:session_id
```

## Frontend

The frontend is intentionally **JavaScript-only**:

- React 19
- Vite
- JavaScript / JSX
- Axios
- Recharts
- Lucide React
- Tailwind CSS tooling

There is no TypeScript compiler, TypeScript source file, or TypeScript configuration in the active frontend.

The interface has two primary experiences:

**Connection workspace**
- one-click demo dataset
- database URL connection
- manual PostgreSQL/MySQL/SQLite connection
- connection validation
- read-only messaging

**Analytics workspace**
- live schema overview
- natural-language query input
- generated SQL inspection
- sortable/paginated result tables
- automatic visual suggestions
- Gemini-generated summaries
- demo-session recovery after backend restarts

## Backend

The backend is now **JavaScript-only Node.js**:

- Node.js 22+
- Express 5
- PostgreSQL via `pg`
- MySQL via `mysql2`
- SQLite via Node's built-in `node:sqlite`
- Gemini via the Google Generative Language API
- Gemini `gemini-embedding-001` for schema embeddings
- ChromaDB for vector retrieval, with an in-process cosine-similarity fallback when a Chroma server is unavailable
- LangGraph.js for the multi-stage query workflow and retry routing
- `node-sql-parser` for SQL parsing/SELECT-only validation
- CORS
- in-memory session management

The backend intentionally keeps the API contract stable so the React application can communicate with the new Express service without changing the product workflow.

## Project structure

```text
data-pilot/
├── backend/
│   ├── agent.js             # LangGraph query workflow + Gemini + guardrails
│   ├── config.js            # Environment + RAG configuration
│   ├── database.js          # DB adapters + sessions + schema inspection
│   ├── demo-db.js           # E-commerce demo database generator
│   ├── rag.js               # Gemini embeddings + ChromaDB schema RAG
│   ├── package.json         # Node backend dependencies
│   └── server.js            # Express API
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── BrandMark.jsx
│   │   │   ├── ConnectionScreen.jsx
│   │   │   ├── DataTable.jsx
│   │   │   ├── QueryInput.jsx
│   │   │   ├── QueryInterface.jsx
│   │   │   ├── ResponseCard.jsx
│   │   │   ├── ResultChart.jsx
│   │   │   ├── SchemaPanel.jsx
│   │   │   └── SkeletonCard.jsx
│   │   ├── api.js
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
└── README.md
```

## Local development

### 1. Backend

```bash
cd backend
npm install
```

Create environment variables:

```env
PORT=8000
DATABASE_URL=sqlite:///./ecommerce.db
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
GEMINI_FALLBACK_MODELS=gemini-3.7-flash,gemini-3.6-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIMENSIONS=768
CHROMA_URL=http://localhost:8001
RAG_TOP_K=5
RAG_SKIP_THRESHOLD=10
FRONTEND_ORIGIN=http://localhost:5173
```

Start the API:

```bash
npm start
```

### Optional: local ChromaDB

Start the vector database used by the semantic schema retriever:

```bash
docker compose -f docker-compose.chroma.yml up -d
```

The Node backend connects to `http://localhost:8001` by default. If Chroma is unavailable, semantic embeddings are still used with an in-process cosine-similarity index.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

For local development, Vite proxies `/api` to `http://localhost:8000`.

For a separately deployed API:

```env
VITE_API_URL=https://your-api.onrender.com
```

## Render deployment

### Backend

The Node service uses:

```text
Runtime: Node
Build:   cd backend && npm install
Start:   cd backend && npm start
```

Required environment variables:

```text
GEMINI_API_KEY
GEMINI_MODEL
GEMINI_FALLBACK_MODELS
DATABASE_URL
FRONTEND_ORIGIN
```

### Frontend

```text
Build:   cd frontend && npm install && npm run build
Publish: frontend/dist
```

Set:

```text
VITE_API_URL=https://your-node-api.onrender.com
```

## Session lifecycle

Sessions are intentionally runtime-only:

```text
POST /api/connect
       ↓
Generate UUID
       ↓
Open DB runtime
       ↓
Inspect schema
       ↓
Store session in memory
       ↓
POST /api/query
       ↓
Execute using that runtime
       ↓
DELETE /api/session/:id
       ↓
Close runtime + remove session
```

A backend restart invalidates active sessions. The frontend automatically reconnects the credential-free demo session when it receives a missing-session response.

Custom database credentials are not written to the repository or persisted as application data.

## Design decisions

### Why Node.js?

The backend is intentionally aligned with the user's full-stack JavaScript workflow. Express provides a small HTTP layer, while Node's asynchronous I/O model is a natural fit for database and Gemini API calls.

### Why JavaScript instead of TypeScript?

This version keeps the entire application approachable from a single JavaScript/React stack. Runtime validation and defensive backend checks are used instead of relying on compile-time TypeScript types.

### Why keep the API contract stable?

The migration changes the backend implementation without forcing a frontend rewrite of the product behavior. Existing endpoints and response fields remain compatible with the React client.

### Why Gemini?

Gemini handles the two language-model tasks in the pipeline:

1. Natural language → SQL
2. SQL result → concise explanation

The database remains the source of truth; the model does not directly modify database state.

## Limitations

- Runtime sessions are stored in process memory and do not survive restarts.
- The application does not persist custom database credentials.
- SQL safety checks are application-level guardrails; production deployments should use database permissions as the primary security boundary.
- Gemini availability can vary by model capacity, so the backend retries temporary failures and supports configured fallback models.
- ChromaDB is an external service in production; if it is unavailable, the backend falls back to an in-process semantic vector index using the same Gemini embeddings.
- Runtime sessions and their schema indexes are process-local and do not survive backend restarts.

## Roadmap

- Persistent schema/index cache
- Stronger SQL parsing/AST validation across PostgreSQL, MySQL, and SQLite
- Streaming query responses
- Saved analytics questions
- Multi-user authentication
- Persistent session storage
- Query audit logs
- More advanced visualization recommendations
- Background query execution for expensive analytics

## License

See the repository for the project's license and source history.
