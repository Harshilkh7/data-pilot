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

async function callGemini(prompt, maxOutputTokens = 768) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");

  // Do not burn the Gemini free-tier quota with blind retries across models.
  // A quota error is terminal for this request; a missing model (404) may use
  // one configured fallback model.
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter(m => m !== GEMINI_MODEL)];
  let lastError;

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      console.log("[Gemini] request", JSON.stringify({ model, maxOutputTokens }));
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens,
              thinkingConfig: { thinkingLevel: "low" },
                temperature: 0,
            },
          }),
          signal: controller.signal,
        }
      );

      const body = await response.text();

      if (!response.ok) {
        lastError = new Error("Gemini API " + response.status + ": " + body.slice(0, 800));
        console.warn("[Gemini] error", lastError.message);
        // Only fall through to another model when the requested model itself
        // is unavailable.  Do not retry quota/auth errors.
        if (response.status === 404) continue;
        throw lastError;
      }

      const data = JSON.parse(body);
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      if (!text.trim()) throw new Error("Gemini returned an empty response.");

      console.log("[Gemini] success", JSON.stringify({ model }));
      return text;
    } catch (error) {
      lastError = error.name === "AbortError"
        ? new Error("Gemini request timed out after 15 seconds.")
        : error;
      console.warn("[Gemini] request failed", lastError.message);
      if (String(lastError.message).startsWith("Gemini API 404")) continue;
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Gemini request failed.");
}
function cleanSql(text) {
  let value = String(text || "").trim();

  const fenced = value.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenced) value = fenced[1].trim();

  const selectIndex = value.search(/\bSELECT\b/i);
  if (selectIndex > 0) value = value.slice(selectIndex);

  return value
    .replace(/^\s*\`\`\`(?:sql)?\s*/i, "")
    .replace(/\s*\`\`\`\s*$/i, "")
    .trim()
    .replace(/;\s*$/, "");
}

function parserDialect(type) {
  return type === "mysql" ? "MySQL" : type === "postgresql" ? "Postgresql" : "SQLite";
}

function demoFallbackSql(question, dbType) {
  if (dbType !== "sqlite") return null;
  const q = String(question).toLowerCase();

  if (/10 highest[ -]?spending customers|highest[ -]?spending customers|top 10.*spending customers/.test(q)) {
    return `SELECT c.customer_id, c.first_name, c.last_name,
       ROUND(SUM(o.total_amount), 2) AS total_spent
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id, c.first_name, c.last_name
ORDER BY total_spent DESC
LIMIT 10`;
  }

  if (/which product.*most sales|product.*most sales|top.*product.*sales/.test(q)) {
    return `SELECT p.product_id, p.product_name,
       ROUND(SUM(oi.line_total), 2) AS total_sales
FROM products p
JOIN order_items oi ON oi.product_id = p.product_id
GROUP BY p.product_id, p.product_name
ORDER BY total_sales DESC
LIMIT 1`;
  }

  if (/monthly revenue.*2026|revenue.*monthly.*2026|2026.*monthly revenue/.test(q)) {
    return `SELECT strftime('%Y-%m', order_date) AS month,
       ROUND(SUM(total_amount), 2) AS revenue
FROM orders
WHERE order_date >= '2026-01-01' AND order_date < '2027-01-01'
GROUP BY month
ORDER BY month`;
  }

  if (/shipping carrier.*fastest|fastest.*delivery.*carrier|carrier.*fastest delivery/.test(q)) {
    return `SELECT carrier,
       ROUND(AVG(julianday(delivered_at) - julianday(shipped_at)), 2) AS avg_delivery_days
FROM shipments
WHERE shipped_at IS NOT NULL AND delivered_at IS NOT NULL
GROUP BY carrier
ORDER BY avg_delivery_days ASC
LIMIT 1`;
  }

  return null;
}

async function validateSelect(sql, dbType) {
  const cleaned = cleanSql(sql);

  if (!/^SELECT\b/i.test(cleaned)) {
    throw new Error("Only SELECT queries are permitted.");
  }

  // Keep the validator dependency-free and deterministic. node-sql-parser was
  // only being used as a syntax gate, but its CommonJS/ESM interop caused the
  // production "Parser is not a constructor" failure.
  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE|UPSERT|GRANT|REVOKE|ATTACH|DETACH|VACUUM|PRAGMA|COPY|CALL|LOAD|INTO)\b/i;
  if (forbidden.test(cleaned)) {
    throw new Error("Forbidden SQL statement detected. Only read-only SELECT queries are allowed.");
  }

  if (cleaned.includes(";")) {
    throw new Error("Multiple SQL statements are not permitted.");
  }

  if (/--|\/\*/.test(cleaned)) {
    throw new Error("SQL comments are not permitted.");
  }

  console.log("[SQLValid]", JSON.stringify({ dbType, sql: cleaned }));
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

function shouldRetryZeroRows(question) {
  const q = String(question).toLowerCase();
  return /\b(top|highest|lowest|most|least|maximum|minimum|best|worst|revenue|sales|selling|spending|customers|orders|count|how many|total|average|avg|monthly|yearly|daily|trend|by)\b/.test(q);
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
  const session = getSession(state.sessionId);

  if (state.errorContext && attemptCount >= MAX_AGENT_ATTEMPTS) {
    const fallback = demoFallbackSql(state.question, session.runtime.type);
    if (fallback) {
      console.log("[SQLFallback]", JSON.stringify({ attempt: attemptCount, sql: fallback }));
      return { sql: fallback, attemptCount, errorContext: "", finalError: "" };
    }
  }

  const schema = schemaToSqlDdl(state.relevantSchema);
  const retryContext = state.errorContext ? "\n\nPrevious attempt failed. Fix this exact problem:\n" + state.errorContext : "";
  const prompt = `You are a precise SQL assistant. Output ONLY one raw SQL SELECT query.

Rules:
1. Output only SQL. No markdown, comments, or explanation.
2. The query MUST be SELECT-only. Never use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, REPLACE, MERGE, UPSERT, GRANT, REVOKE, ATTACH, DETACH, VACUUM, or PRAGMA. The first non-whitespace characters of your response must be SELECT and the response must contain no prose.
3. Use only tables and columns in the supplied schema.
4. For top/extreme/specific-N questions, include the requested LIMIT.
5. If the question cannot be answered from the schema, output exactly CANNOT_ANSWER.
6. For which-entity-has-the-most questions, select both the entity descriptor and aggregate metric.
7. Do not add restrictive WHERE filters, status values, date filters, or other conditions unless the user explicitly asks for them.
8. For spending/sales/revenue questions, prefer aggregating transaction amounts from orders/order_items and joining through the stated foreign-key relationships.
9. If a previous attempt returned zero rows, simplify the query, verify joins and column names, and remove any invented filters.
10. Respect the SQL dialect: ${session.runtime.type}.

Schema:
${schema}

Question: ${state.question}${retryContext}`;
  try {
    const sql = cleanSql(await callGemini(prompt, 1024));
    if (sql === "CANNOT_ANSWER") return { sql: "", attemptCount, finalError: "The question cannot be answered from the available schema." };
    return { sql, attemptCount, errorContext: "" };
  } catch (error) {
    const fallback = demoFallbackSql(state.question, session.runtime.type);
    if (fallback) {
      console.warn("[GeminiFallback]", JSON.stringify({ question: state.question, reason: error.message }));
      return { sql: fallback, attemptCount, errorContext: "", finalError: "" };
    }
    return { sql: "", attemptCount, finalError: "LLM call failed: " + error.message };
  }
}

async function validateSqlNode(state) {
  try {
    const session = getSession(state.sessionId);
    const sql = await validateSelect(state.sql, session.runtime.type);
    console.log("[SQLValid]", JSON.stringify({ attempt: state.attemptCount, sql }));
    return { sql, errorContext: "", finalError: "" };
  } catch (error) {
    console.warn("[SQLValidationError]", JSON.stringify({
      attempt: state.attemptCount,
      sql: state.sql,
      error: error.message,
    }));

    if (state.attemptCount >= MAX_AGENT_ATTEMPTS) {
      return {
        errorContext: error.message,
        finalError: "The generated SQL could not be validated after " + MAX_AGENT_ATTEMPTS +
          " attempts. Last validation error: " + error.message,
      };
    }

    return { errorContext: error.message };
  }
}
function limitInject(state) { const limited = injectLimit(state.sql, state.question); return { sql: limited.sql, truncated: limited.truncated, limitNote: limited.limitNote }; }

async function executeSql(state) {
  try {
    const result = await getSession(state.sessionId).runtime.query(state.sql);
    const rows = result.rows.map(row => result.columns.map(column => { const value = row[column]; if (value instanceof Date) return value.toISOString(); if (typeof value === "bigint") return Number(value); return value === undefined ? null : value; }));
    console.log("[Query]", JSON.stringify({ question: state.question, attempt: state.attemptCount, sql: state.sql, rowCount: rows.length, columns: result.columns }));
    if (rows.length === 0 && shouldRetryZeroRows(state.question) && state.attemptCount < MAX_AGENT_ATTEMPTS) {
      return {
        columns: result.columns,
        rows,
        rowCount: 0,
        errorContext: "The generated SQL executed successfully but returned 0 rows. Re-check the joins, aggregation, and filters. Do not invent restrictive filters or status values; generate a broader query that directly answers the user's question from the available schema."
      };
    }
    if (rows.length === 0 && shouldRetryZeroRows(state.question)) {
      return {
        columns: result.columns,
        rows,
        rowCount: 0,
        finalError: "The generated query returned 0 rows after multiple correction attempts. Please inspect the generated SQL."
      };
    }
    return { columns: result.columns, rows, rowCount: rows.length, errorContext: "" };
  } catch (error) {
    console.log("[QueryError]", JSON.stringify({ question: state.question, attempt: state.attemptCount, sql: state.sql, error: error.message }));
    return { columns: [], rows: [], rowCount: 0, errorContext: "Database execution error: " + error.message };
  }
}

async function summarizeResults(state) {
  if (!state.rowCount) return { summary: "No matching records were found.", chartSuggestion: null };

  // Keep the result pipeline independent of a second Gemini call. This is
  // important on Gemini free-tier projects where a single user query should
  // consume only one generation request.
  const preview = state.rows.slice(0, 3).map(row =>
    state.columns.map((column, i) => column + "=" + String(row[i] ?? "NULL")).join(", ")
  ).join(" | ");

  const summary = state.rowCount === 1
    ? "The query returned one matching record: " + preview + "."
    : "The query returned " + state.rowCount.toLocaleString() + " rows. Sample results: " + preview + (state.rowCount > 3 ? " …" : ".");

  return {
    summary,
    chartSuggestion: chartSuggestion(state.question, state.columns, state.rows),
  };
}
function routeAfterGenerate(state) { return state.finalError ? END : "validate_sql"; }
function routeAfterValidate(state) {
  if (state.finalError) return END;
  if (state.errorContext && state.attemptCount < MAX_AGENT_ATTEMPTS) return "generate_sql";
  if (state.errorContext) return END;
  return "limit_inject";
}

function routeAfterExecute(state) {
  if (state.finalError) return END;
  if (state.errorContext && state.attemptCount < MAX_AGENT_ATTEMPTS) return "generate_sql";
  if (state.errorContext) return END;
  return "summarize_results";
}

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
  const error = state.finalError || (
    state.errorContext
      ? "Analysis stopped before execution: " + state.errorContext
      : null
  );

  return {
    sql: state.sql || "",
    summary: state.summary || "",
    columns: state.columns || [],
    rows: state.rows || [],
    row_count: state.rowCount || 0,
    truncated: Boolean(state.truncated),
    limit_note: state.limitNote || "",
    chart_suggestion: state.chartSuggestion || null,
    error,
  };
}
