import express from "express";
import cors from "cors";
import { PORT, ALLOWED_ORIGINS, GEMINI_MODEL, DATABASE_URL, READ_ONLY_MODE, GEMINI_API_KEY } from "./config.js";
import { validateAndConnect, connectFromDemo, getSession, removeSession, schemaOverview, SESSION_STORE } from "./database.js";
import { answerQuestion } from "./agent.js";
import { indexSchema, removeSchemaIndex } from "./rag.js";

const app = express();
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok", sessions_active: SESSION_STORE.size }));

async function connectHandler(req, res) {
  try {
    const body = req.body || {};
    let connectionString = body.connection_string;
    if (!connectionString && body.db_type && body.database) {
      const db = String(body.db_type).toLowerCase();
      if (db === "sqlite") connectionString = `sqlite:///${body.database}`;
      else if (db === "postgresql") connectionString = `postgresql+ignored://${body.username}:${body.password}@${body.host}:${body.port || 5432}/${body.database}`.replace("postgresql+ignored://","postgresql://");
      else if (db === "mysql") connectionString = `mysql://${encodeURIComponent(body.username || "")}:${encodeURIComponent(body.password || "")}@${body.host}:${body.port || 3306}/${body.database}`;
      else return res.status(400).json({ detail: "Unsupported db_type." });
    }
    if (!connectionString) return res.status(400).json({ detail: "Provide either connection_string or structured database fields." });
    const [sessionId, session] = await validateAndConnect(connectionString, body.read_only_connection_string);
    const rag = await indexSchema(sessionId);
    const overview = await schemaOverview(session);
    res.json({
      session_id: sessionId,
      database_name: session.runtime.name,
      db_type: session.runtime.type,
      schema_overview: overview,
      rag: { indexed_tables: rag.indexed, provider: rag.provider },
      message: `Connected to '${session.runtime.name}' (${session.tableNames.length} tables).`
    });
  } catch (err) {
    console.error("Connection failed:", err);
    res.status(422).json({ detail: `Database connection failed: ${err.message}` });
  }
}

app.post("/api/connect", connectHandler);
app.post("/api/demo-connect", async (req, res) => {
  try {
    const [sessionId, session] = await connectFromDemo();
    const overview = await schemaOverview(session);
    res.json({
      session_id: sessionId,
      database_name: session.runtime.name,
      db_type: session.runtime.type,
      schema_overview: overview,
      message: `Demo mode: connected to '${session.runtime.name}' (${session.tableNames.length} tables).`
    });
  } catch (err) {
    console.error("Demo connect failed:", err);
    res.status(500).json({ detail: `E-commerce demo database connection failed: ${err.message}` });
  }
});

app.post("/api/query", async (req, res) => {
  const { session_id, question } = req.body || {};
  if (!question || !String(question).trim()) return res.status(400).json({ detail: "Question cannot be empty." });
  if (!SESSION_STORE.has(session_id)) return res.status(404).json({ detail: `Session '${session_id}' not found. Please reconnect via /api/connect.` });
  const started = performance.now();
  try {
    const result = await answerQuestion(session_id, String(question).trim());
    res.json({ ...result, elapsed_ms: Number((performance.now() - started).toFixed(1)) });
  } catch (err) {
    console.error("Query pipeline error:", err);
    res.status(500).json({ detail: `Query pipeline error: ${err.message}` });
  }
});

app.delete("/api/session/:sessionId", async (req, res) => {
  if (!SESSION_STORE.has(req.params.sessionId)) return res.status(404).json({ detail: "Session not found." });
  await removeSchemaIndex(req.params.sessionId);
  await removeSession(req.params.sessionId);
  res.json({ message: `Session '${req.params.sessionId}' disconnected.` });
});

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  res.status(500).json({ detail: `Internal server error: ${err.message}` });
});

app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("  DataPilot API — Node.js + Express");
  console.log("  Port        :", PORT);
  console.log("  Gemini model:", GEMINI_MODEL);
  console.log("  Demo DB     :", DATABASE_URL);
  console.log("  Read-only   :", READ_ONLY_MODE);
  console.log("  Gemini key  :", GEMINI_API_KEY ? "configured" : "missing");
  console.log("  CORS origins:", ALLOWED_ORIGINS);
  console.log("=".repeat(60));
});
