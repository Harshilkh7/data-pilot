# DataPilot — AI-Powered Natural Language Data Analyst

Talk to your SQL database in plain English. DataPilot turns natural-language questions into safe SQL, executes them against your connected database, and returns concise insights, tables, and charts.

## Stack

- React + Vite + TypeScript + Recharts
- FastAPI + SQLAlchemy + LangGraph
- Google Gemini for SQL generation, result summarization, and schema embeddings
- ChromaDB for schema retrieval
- sqlglot for SQL validation

## Local setup

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Copy `.env.example` to `.env` and set `GEMINI_API_KEY`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://localhost:8000`.

## Environment

Backend:

- `GEMINI_API_KEY` — required
- `GEMINI_MODEL` — optional, defaults to `gemini-2.5-flash`
- `DATABASE_URL` — optional demo/default database URL
- `READ_ONLY_DATABASE_URL` — optional dedicated read-only query connection
- `READ_ONLY_MODE` — set `true` to enforce the read-only connection
- `FRONTEND_ORIGIN` — deployed frontend origin for CORS

Frontend:

- `VITE_API_URL` — optional deployed backend URL

## Safety

DataPilot only executes validated `SELECT` queries. For production databases, use a dedicated read-only database account.

## Deployment

Deploy the FastAPI service to Render and the `frontend/` application to Vercel. Configure the environment variables above in each platform.
