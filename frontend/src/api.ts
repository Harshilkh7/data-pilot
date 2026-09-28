// src/api.ts — API client for the DataPilot FastAPI backend
/// <reference types="vite/client" />
import axios from 'axios';
import type { ConnectResponse, QueryResponse } from './types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 120_000, // 2 minutes — LLM + DB can be slow
  headers: { 'Content-Type': 'application/json' },
});

// ─── Connection ────────────────────────────────────────────────────────────

export async function connectWithString(
  connectionString: string,
  readOnlyConnectionString?: string,
): Promise<ConnectResponse> {
  const res = await client.post<ConnectResponse>('/api/connect', {
    connection_string: connectionString,
    read_only_connection_string: readOnlyConnectionString || undefined,
  });
  return res.data;
}

export async function connectManual(fields: {
  db_type: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}): Promise<ConnectResponse> {
  const res = await client.post<ConnectResponse>('/api/connect', {
    db_type: fields.db_type,
    host: fields.host,
    port: parseInt(fields.port) || undefined,
    database: fields.database,
    username: fields.username || undefined,
    password: fields.password || undefined,
  });
  return res.data;
}

export async function connectDemo(): Promise<ConnectResponse> {
  const res = await client.post<ConnectResponse>('/api/demo-connect');
  return res.data;
}

export async function disconnectSession(sessionId: string): Promise<void> {
  await client.delete(`/api/session/${sessionId}`);
}

// ─── Query ────────────────────────────────────────────────────────────────

export async function runQuery(
  sessionId: string,
  question: string,
): Promise<QueryResponse> {
  const res = await client.post<QueryResponse>('/api/query', {
    session_id: sessionId,
    question,
  });
  return res.data;
}

// ─── Health ───────────────────────────────────────────────────────────────

export async function getHealth(): Promise<{ status: string }> {
  const res = await client.get<{ status: string }>('/api/health');
  return res.data;
}
