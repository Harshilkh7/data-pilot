import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "https://datapilot-api-node.onrender.com";
const client = axios.create({
  baseURL: BASE_URL,
  timeout: 120000,
  headers: {"Content-Type":"application/json"}
});

export async function connectWithString(connectionString, readOnlyConnectionString) {
  const res = await client.post("/api/connect", {
    connection_string: connectionString,
    read_only_connection_string: readOnlyConnectionString || undefined
  });
  return res.data;
}

export async function connectManual(fields) {
  const res = await client.post("/api/connect", {
    db_type: fields.db_type,
    host: fields.host,
    port: parseInt(fields.port, 10) || undefined,
    database: fields.database,
    username: fields.username || undefined,
    password: fields.password || undefined
  });
  return res.data;
}

export async function connectDemo() {
  const res = await client.post("/api/demo-connect");
  return res.data;
}

export async function disconnectSession(sessionId) {
  await client.delete(`/api/session/${sessionId}`);
}

export async function runQuery(sessionId, question) {
  const res = await client.post("/api/query", {session_id: sessionId, question});
  return res.data;
}

export async function getHealth() {
  const res = await client.get("/api/health");
  return res.data;
}
