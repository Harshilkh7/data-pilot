// src/types.ts — shared TypeScript interfaces for DataPilot

export interface SchemaTable {
  table: string;
  row_count: number;
}

export interface ConnectResponse {
  session_id: string;
  database_name: string;
  db_type: string;
  schema_overview: SchemaTable[];
  message: string;
}

export interface ChartSuggestion {
  type: 'bar' | 'line' | 'pie';
  x: string;
  y: string;
}

export interface QueryResponse {
  sql: string;
  summary: string;
  columns: string[];
  rows: (string | number | null)[][];
  row_count: number;
  truncated: boolean;
  limit_note: string;
  chart_suggestion: ChartSuggestion | null;
  error: string | null;
  elapsed_ms: number;
}

export interface QueryHistoryItem {
  id: string;
  question: string;
  response: QueryResponse;
  timestamp: Date;
}

export type ConnectionMode = 'string' | 'manual';

export interface ManualConnectionFields {
  db_type: 'postgresql' | 'mysql' | 'sqlite';
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

export interface AppSession {
  session_id: string;
  database_name: string;
  db_type: string;
  schema_overview: SchemaTable[];
}
