import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import mysql from "mysql2/promise";
import { DATABASE_URL, READ_ONLY_DATABASE_URL, READ_ONLY_MODE } from "./config.js";
import { ensureDemoDatabase } from "./demo-db.js";

const { Pool } = pg;
export const SESSION_STORE = new Map();

function parseUrl(connectionString) {
  const value = connectionString.trim();
  const lower = value.toLowerCase();
  if (lower.startsWith("sqlite:///")) return { type: "sqlite", path: value.slice("sqlite:///".length) };
  if (lower.startsWith("sqlite://")) return { type: "sqlite", path: value.slice("sqlite://".length) };
  if (lower.startsWith("postgresql://") || lower.startsWith("postgres://")) return { type: "postgresql", url: value };
  if (lower.startsWith("mysql://") || lower.startsWith("mysql2://")) return { type: "mysql", url: value.replace(/^mysql2:/i, "mysql:") };
  throw new Error("Unsupported database URL. Use PostgreSQL, MySQL, or SQLite.");
}

function resolveSqlitePath(p) {
  if (p === ":memory:") return p;
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

function databaseName(parsed) {
  if (parsed.type === "sqlite") return path.basename(resolveSqlitePath(parsed.path));
  try { return decodeURIComponent(new URL(parsed.url).pathname.split("/").filter(Boolean).pop() || "database"); }
  catch { return "database"; }
}

function quoteIdent(name, type) {
  if (type === "mysql") return "`" + String(name).replaceAll("`", "``") + "`";
  return '"' + String(name).replaceAll('"', '""') + '"';
}

async function createRuntime(connectionString, readOnlyConnectionString) {
  const parsed = parseUrl(connectionString);
  if (parsed.type === "sqlite") {
    const file = resolveSqlitePath(parsed.path);
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    return {
      type: "sqlite", name: databaseName(parsed), primary: db, readonly: db,
      async test() { db.prepare("SELECT 1").get(); },
      async close() { db.close(); },
      async query(sql) { const stmt = db.prepare(sql); return { columns: stmt.columns().map(c => c.name), rows: stmt.all() }; }
    };
  }

  if (parsed.type === "postgresql") {
    const pool = new Pool({ connectionString: parsed.url, max: 5, idleTimeoutMillis: 30000 });
    const ro = readOnlyConnectionString ? new Pool({ connectionString: readOnlyConnectionString, max: 5 }) : pool;
    await pool.query("SELECT 1");
    return {
      type: "postgresql", name: databaseName(parsed), primary: pool, readonly: ro,
      async test() { await pool.query("SELECT 1"); },
      async close() { await pool.end(); if (ro !== pool) await ro.end(); },
      async query(sql) { const r = await ro.query(sql); return { columns: r.fields.map(f => f.name), rows: r.rows }; }
    };
  }

  const pool = mysql.createPool({ uri: parsed.url, connectionLimit: 5, waitForConnections: true });
  const ro = readOnlyConnectionString ? mysql.createPool({ uri: readOnlyConnectionString, connectionLimit: 5 }) : pool;
  await pool.query("SELECT 1");
  return {
    type: "mysql", name: databaseName(parsed), primary: pool, readonly: ro,
    async test() { await pool.query("SELECT 1"); },
    async close() { await pool.end(); if (ro !== pool) await ro.end(); },
    async query(sql) { const [rows] = await ro.query(sql); return { columns: rows.length ? Object.keys(rows[0]) : [], rows }; }
  };
}

async function introspect(runtime) {
  if (runtime.type === "sqlite") {
    const tables = runtime.primary.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
    const schemas = [];
    for (const table of tables) {
      const cols = runtime.primary.prepare("PRAGMA table_info(" + quoteIdent(table, "sqlite") + ")").all();
      schemas.push({ table, columns: cols.map(c => ({ name: c.name, type: c.type || "TEXT" })) });
    }
    return schemas;
  }
  if (runtime.type === "postgresql") {
    const { rows } = await runtime.primary.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
    const schemas = [];
    for (const r of rows) {
      const c = await runtime.primary.query(`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [r.table_name]);
      schemas.push({ table: r.table_name, columns: c.rows.map(x => ({ name: x.column_name, type: x.data_type })) });
    }
    return schemas;
  }
  const db = runtime.name;
  const [tables] = await runtime.primary.query("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE' ORDER BY table_name", [db]);
  const schemas = [];
  for (const r of tables) {
    const [c] = await runtime.primary.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position", [db, r.table_name]);
    schemas.push({ table: r.table_name, columns: c.map(x => ({ name: x.column_name, type: x.data_type })) });
  }
  return schemas;
}

export async function validateAndConnect(connectionString, readOnlyConnectionString) {
  const runtime = await createRuntime(connectionString, READ_ONLY_MODE ? (readOnlyConnectionString || READ_ONLY_DATABASE_URL) : readOnlyConnectionString);
  const schemas = await introspect(runtime);
  const sessionId = crypto.randomUUID();
  const session = { sessionId, runtime, tableNames: schemas.map(s => s.table), schemas };
  SESSION_STORE.set(sessionId, session);
  return [sessionId, session];
}

export async function connectFromDemo() {
  const parsed = parseUrl(DATABASE_URL);
  if (parsed.type !== "sqlite") throw new Error("Hosted demo must use a SQLite DATABASE_URL.");
  const dbPath = resolveSqlitePath(parsed.path);
  ensureDemoDatabase(dbPath);
  return validateAndConnect(DATABASE_URL);
}

export function getSession(id) {
  const session = SESSION_STORE.get(id);
  if (!session) throw new Error("Session not found. Please reconnect.");
  return session;
}

export async function removeSession(id) {
  const session = SESSION_STORE.get(id);
  if (!session) return;
  SESSION_STORE.delete(id);
  await session.runtime.close();
}

export async function schemaOverview(session) {
  const out = [];
  for (const table of session.tableNames) {
    try {
      const result = await session.runtime.query(`SELECT COUNT(*) AS count FROM ${quoteIdent(table, session.runtime.type)}`);
      out.push({ table, row_count: Number(Object.values(result.rows[0] || { count: 0 })[0] || 0) });
    } catch { out.push({ table, row_count: -1 }); }
  }
  return out;
}
