import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { getSession } from "./database.js";
import { retrieveRelevantTables, schemaToSqlDdl } from "./rag.js";
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODELS, MAX_AGENT_ATTEMPTS, DEFAULT_ROW_LIMIT, ALL_ROWS_LIMIT } from "./config.js";

const ALL_ROWS = /\b(all|every|entire|full|export|complete|whole)\b/i;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE|UPSERT|GRANT|REVOKE|ATTACH|DETACH|VACUUM|PRAGMA)\b/i;
const AgentState = Annotation.Root({
  sessionId: Annotation(), question: Annotation(), fullSchema: Annotation({ default: () => [] }), relevantSchema: Annotation({ default: () => [] }),
  sql: Annotation({ default: () => "" }), attemptCount: Annotation({ default: () => 0 }), errorContext: Annotation({ default: () => "" }),
  truncated: Annotation({ default: () => false }), limitNote: Annotation({ default: () => "" }), columns: Annotation({ default: () => [] }), rows: Annotation({ default: () => [] }),
  rowCount: Annotation({ default: () => 0 }), summary: Annotation({ default: () => "" }), chartSuggestion: Annotation({ default: () => null }), finalError: Annotation({ default: () => "" }),
});

async function callGemini(prompt, maxOutputTokens = 1024) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter(m => m !== GEMINI_MODEL)];
  let lastError;
  for (const model of models) {
    let delay = 5000;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + GEMINI_API_KEY, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens } }),
        });
        const body = await response.text();
        if (!response.ok) {
          lastError = new Error("Gemini API " + response.status + ": " + body.slice(0, 500));
          if (![429, 500, 502, 503, 504].includes(response.status)) break;
          if (attempt < 3) { await new Promise(r => setTimeout(r, delay)); delay = Math.min(delay * 2, 40000); continue; }
          break;
        }
        const data = JSON.parse(body);
        return data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      } catch (error) {
        lastError = error;
        if (attempt < 3) { await new Promise(r => setTimeout(r, delay)); delay = Math.min(delay * 2, 40000); }
      }
    }
  }
  throw lastError || new Error("Gemini request failed.");
}

function cleanSql(text) { return String(text).replace(/^\s*```(?:sql)?\s*/i, "").replace(/\s*```\s*$/i, "").trim().replace(/;\s*$/, ""); }
function parserDialect(type) { return type === "mysql" ? "MySQL" : type === "postgresql" ? "Postgresql" : "SQLite"; }

async function validateSelect(sql, dbType) {
  const cleaned = cleanSql(sql);
  if (!/^SELECT\b/i.test(cleaned)) throw new Error("Only SELECT queries are permitted.");
  if (FORBIDDEN.test(cleaned)) throw new Error("Forbidden SQL statement detected. Only read-only SELECT queries are allowed.");
  if (cleaned.includes(";")) throw new Error("Multiple SQL statements are not permitted.");
  try {
    const { Parser } = await import("node-sql-parser");
    const ast = new Parser().astify(cleaned, { database: parserDialect(dbType) });
    const statements = Array.isArray(ast) ? ast : [ast];
    for (const statement of statements) if (String(statement?.type || "").toLowerCase() !== "select") throw new Error("Only SELECT queries are permitted. Got: " + (statement?.type || "unknown") + ".");
  } catch (error) {
    if (String(error.message).startsWith("Only SELECT")) throw error;
    throw new Error("SQL parse error: " + error.message);
  }
  return cleaned;
}

function injectLimit(sql, question) {
  const cap = ALL_ROWS.test(question) ? ALL_ROWS_LIMIT : DEFAULT_ROW_LIMIT;
  const match = sql.match(/\bLIMIT\s+(\d+)\b/i);
  if (match) {
    const current = Number(match[1]);
    if (current <= cap) return { sql, truncated: false, limitNote: "" };
    return { sql: sql.replace(/\bLIMIT\s+\d+\b/i, "LIMIT " + cap), truncated: true, limitNote: "Your query's LIMIT was reduced to " + cap + " rows to protect database performance." };
  }
  return { sql: sql + " LIMIT " + cap, truncated: true, limitNote: ALL_ROWS.test(question) ? "Results are capped at " + cap.toLocaleString() + " rows because your question requested a broad result set." : "Results are limited to " + cap.toLocaleString() + " rows. Use a more specific filter to see fewer results." };
}

function chartSuggestion(question, columns, rows) {
  if (rows.length < 2 || columns.length < 2 || columns.length > 6) return null;
  const q = question.toLowerCase();
  const timeColumn = columns.find(c => /date|year|month|time/i.test(c));
  const numericColumn = columns.find(c => !/date|year|month|time/i.test(c));
  if (timeColumn && numericColumn && /over time|trend|monthly|yearly|daily|date/.test(q)) return { type: "line", x: timeColumn, y: numericColumn };
  if (/proportion|percentage|share|distribution|breakdown/.test(q)) return { type: "pie", x: columns[0], y: columns[1] };
  if (/count|total|sum|average|avg|per|by|group|top|highest|most/.test(q) || columns.length === 2) return { type: "bar", x: columns[0], y: columns[1] };
  return null;
}

async function retrieveSchema(state) {
  try { const session = getSession(state.sessionId); return { fullSchema: session.schemas, relevantSchema: await retrieveRelevantTables(state.sessionId, state.question, session.schemas) }; }
  catch (error) { return { fullSchema: [], relevantSchema: [], finalError: error.message }; }
}

async function generateSql(state) {
  const attemptCount = state.attemptCount + 1;
  const schema = schemaToSqlDdl(state.relevantSchema);
  const retryContext = state.errorContext ? "\n\nPrevious attempt failed. Fix this exact problem:\n" + state.errorContext : "";
  const session = getSession(state.sessionId);
  const prompt = `You are a precise SQL assistant. Output ONLY one raw SQL SELECT query.

Rules:
1. Output only SQL. No markdown, comments, or explanation.
2. The query MUST be SELECT-only. Never use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, REPLACE, MERGE, UPSERT, GRANT, REVOKE, ATTACH, DETACH, VACUUM, or PRAGMA.
3. Use only tables and columns in the supplied schema.
4. For top/extreme/specific-N questions, include the requested LIMIT.
5. If the question cannot be answered from the schema, output exactly CANNOT_ANSWER.
6. For which-entity-has-the-most questions, select both the entity descriptor and aggregate metric.
7. Respect the SQL dialect: ${session.runtime.type}.

Schema:
${schema}

Question: ${state.question}${retryContext}`;
  try {
    const sql = cleanSql(await callGemini(prompt, 1024));
    if (sql === "CANNOT_ANSWER") return { sql: "", attemptCount, finalError: "The question cannot be answered from the available schema." };
    return { sql, attemptCount, errorContext: "" };
  } catch (error) { return { sql: "", attemptCount, finalError: "LLM call failed: " + error.message }; }
}

async function validateSqlNode(state) {
  try { const session = getSession(state.sessionId); return { sql: await validateSelect(state.sql, session.runtime.type), errorContext: "" }; }
  catch (error) { return { errorContext: error.message }; }
}
function limitInject(state) { const limited = injectLimit(state.sql, state.question); return { sql: limited.sql, truncated: limited.truncated, limitNote: limited.limitNote }; }

async function executeSql(state) {
  try {
    const result = await getSession(state.sessionId).runtime.query(state.sql);
    const rows = result.rows.map(row => result.columns.map(column => { const value = row[column]; if (value instanceof Date) return value.toISOString(); if (typeof value === "bigint") return Number(value); return value === undefined ? null : value; }));
    return { columns: result.columns, rows, rowCount: rows.length, errorContext: "" };
  } catch (error) { return { columns: [], rows: [], rowCount: 0, errorContext: "Database execution error: " + error.message }; }
}

async function summarizeResults(state) {
  if (!state.rowCount) return { summary: "No matching records were found.", chartSuggestion: null };
  const preview = JSON.stringify({ columns: state.columns, rows: state.rows.slice(0, 50), total_rows: state.rowCount });
  try {
    const summary = (await callGemini(`You are a data analyst assistant. Write a concise 1-3 sentence natural-language summary of the findings. Do not mention SQL syntax. Focus on what the data reveals.

User question: ${state.question}

Query results:
${preview}`, 256)).trim();
    return { summary, chartSuggestion: chartSuggestion(state.question, state.columns, state.rows) };
  } catch { return { summary: "Query returned " + state.rowCount.toLocaleString() + " row(s).", chartSuggestion: chartSuggestion(state.question, state.columns, state.rows) }; }
}

function routeAfterGenerate(state) { return state.finalError ? END : "validate_sql"; }
function routeAfterValidate(state) { if (state.finalError) return END; if (state.errorContext && state.attemptCount < MAX_AGENT_ATTEMPTS) return "generate_sql"; if (state.errorContext) return END; return "limit_inject"; }
function routeAfterExecute(state) { if (state.errorContext && state.attemptCount < MAX_AGENT_ATTEMPTS) return "generate_sql"; if (state.errorContext) return END; return "summarize_results"; }

const graph = new StateGraph(AgentState)
  .addNode("retrieve_schema", retrieveSchema)
  .addNode("generate_sql", generateSql)
  .addNode("validate_sql", validateSqlNode)
  .addNode("limit_inject", limitInject)
  .addNode("execute_sql", executeSql)
  .addNode("summarize_results", summarizeResults)
  .addEdge(START, "retrieve_schema")
  .addEdge("retrieve_schema", "generate_sql")
  .addConditionalEdges("generate_sql", routeAfterGenerate, { validate_sql: "validate_sql", [END]: END })
  .addConditionalEdges("validate_sql", routeAfterValidate, { generate_sql: "generate_sql", limit_inject: "limit_inject", [END]: END })
  .addEdge("limit_inject", "execute_sql")
  .addConditionalEdges("execute_sql", routeAfterExecute, { generate_sql: "generate_sql", summarize_results: "summarize_results", [END]: END })
  .addEdge("summarize_results", END)
  .compile();

export async function answerQuestion(sessionId, question) {
  const state = await graph.invoke({ sessionId, question, fullSchema: [], relevantSchema: [], sql: "", attemptCount: 0, errorContext: "", truncated: false, limitNote: "", columns: [], rows: [], rowCount: 0, summary: "", chartSuggestion: null, finalError: "" });
  return { sql: state.sql || "", summary: state.summary || "", columns: state.columns || [], rows: state.rows || [], row_count: state.rowCount || 0, truncated: Boolean(state.truncated), limit_note: state.limitNote || "", chart_suggestion: state.chartSuggestion || null, error: state.finalError || null };
}
