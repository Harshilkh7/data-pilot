import { getSession } from "./database.js";
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODELS, MAX_AGENT_ATTEMPTS, DEFAULT_ROW_LIMIT, ALL_ROWS_LIMIT } from "./config.js";

const ALL_ROWS = /\b(all|every|entire|full|export|complete|whole)\b/i;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE|UPSERT|GRANT|REVOKE)\b/i;

function schemaText(schemas) {
  return schemas.map(t => `TABLE ${t.table} (\n${t.columns.map(c => `  ${c.name} ${c.type}`).join(",\n")}\n)`).join("\n\n");
}

function relevantSchemas(schemas, question) {
  if (schemas.length <= 10) return schemas;
  const tokens = question.toLowerCase().split(/\W+/).filter(Boolean);
  return [...schemas]
    .map(s => {
      const hay = (s.table + " " + s.columns.map(c => c.name).join(" ")).toLowerCase();
      const score = tokens.reduce((n,t) => n + (hay.includes(t) ? 1 : 0), 0);
      return { s, score };
    })
    .sort((a,b) => b.score-a.score)
    .slice(0,5)
    .map(x => x.s);
}

async function callGemini(prompt, maxOutputTokens=1024) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter(m => m !== GEMINI_MODEL)];
  let lastError;
  for (const model of models) {
    let delay = 3000;
    for (let attempt=0; attempt<4; attempt++) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ contents:[{role:"user",parts:[{text:prompt}]}], generationConfig:{maxOutputTokens} })
        });
        const body = await response.text();
        if (!response.ok) {
          lastError = new Error(`Gemini API ${response.status}: ${body.slice(0,500)}`);
          if (![429,500,502,503,504].includes(response.status)) break;
          if (attempt < 3) { await new Promise(r=>setTimeout(r,delay)); delay=Math.min(delay*2,20000); continue; }
          break;
        }
        const data = JSON.parse(body);
        return data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("") || "";
      } catch (err) {
        lastError = err;
        if (attempt < 3) { await new Promise(r=>setTimeout(r,delay)); delay=Math.min(delay*2,20000); }
      }
    }
  }
  throw lastError || new Error("Gemini request failed.");
}

function cleanSql(text) {
  return String(text).replace(/^\s*```(?:sql)?\s*/i,"").replace(/\s*```\s*$/,"").trim().replace(/;\s*$/,"");
}

function validateSelect(sql) {
  const cleaned = cleanSql(sql);
  if (!/^SELECT\b/i.test(cleaned)) throw new Error("Only SELECT queries are permitted.");
  if (FORBIDDEN.test(cleaned)) throw new Error("Forbidden SQL statement detected. Only read-only SELECT queries are allowed.");
  if (cleaned.includes(";")) throw new Error("Multiple SQL statements are not permitted.");
  return cleaned;
}

function injectLimit(sql, question) {
  const cap = ALL_ROWS.test(question) ? ALL_ROWS_LIMIT : DEFAULT_ROW_LIMIT;
  const match = sql.match(/\bLIMIT\s+(\d+)\b/i);
  if (match) {
    const current = Number(match[1]);
    if (current <= cap) return { sql, truncated:false, limit_note:"" };
    return { sql: sql.replace(/\bLIMIT\s+\d+\b/i,`LIMIT ${cap}`), truncated:true, limit_note:`Your query's LIMIT was reduced to ${cap} rows to protect database performance.` };
  }
  return {
    sql: `${sql} LIMIT ${cap}`,
    truncated:true,
    limit_note: ALL_ROWS.test(question)
      ? `Results are capped at ${cap.toLocaleString()} rows because your question requested a broad result set.`
      : `Results are limited to ${cap.toLocaleString()} rows. Use a more specific filter to see fewer results.`
  };
}

function chartSuggestion(question, columns, rows) {
  if (rows.length < 2 || columns.length < 2 || columns.length > 6) return null;
  const q = question.toLowerCase();
  const time = columns.find(c => /date|year|month|time/i.test(c));
  const numeric = columns.find(c => !(/date|year|month|time/i.test(c)));
  if (time && numeric && /over time|trend|monthly|yearly|daily|date/.test(q)) return {type:"line",x:time,y:numeric};
  if (/proportion|percentage|share|distribution|breakdown/.test(q)) return {type:"pie",x:columns[0],y:columns[1]};
  if (/count|total|sum|average|avg|per|by|group|top|highest|most/.test(q) || columns.length===2) return {type:"bar",x:columns[0],y:columns[1]};
  return null;
}

async function summarize(question, columns, rows) {
  if (!rows.length) return "No matching records were found.";
  const sample = rows.slice(0,50);
  try {
    return (await callGemini(
      `You are a concise data analyst. Summarize the result in 1-3 sentences. Do not mention SQL. Focus on the answer to the user's question.\nQuestion: ${question}\nColumns: ${columns.join(", ")}\nRows: ${JSON.stringify(sample)}`,
      400
    )).trim();
  } catch {
    return `The query returned ${rows.length.toLocaleString()} row(s).`;
  }
}

export async function answerQuestion(sessionId, question) {
  const session = getSession(sessionId);
  let errorContext = "";
  let sql = "";
  let truncated = false;
  let limit_note = "";
  let columns = [];
  let rows = [];
  let finalError = "";

  for (let attempt=1; attempt<=MAX_AGENT_ATTEMPTS; attempt++) {
    try {
      const relevant = relevantSchemas(session.schemas, question);
      const prompt = `You are a precise SQL assistant. Output ONLY one raw SQL SELECT query. Never use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, REPLACE, MERGE, GRANT or REVOKE. Use only tables and columns in the schema. Include a LIMIT for explicit top-N requests. If impossible from the schema, output CANNOT_ANSWER.\n\nSchema:\n${schemaText(relevant)}\n\nQuestion: ${question}${errorContext ? `\n\nPrevious attempt failed. Fix this: ${errorContext}` : ""}`;
      sql = cleanSql(await callGemini(prompt, 1024));
      if (sql === "CANNOT_ANSWER") throw new Error("The question cannot be answered from the available schema.");
      sql = validateSelect(sql);
      const limited = injectLimit(sql, question);
      sql = limited.sql; truncated = limited.truncated; limit_note = limited.limit_note;

      const result = await session.runtime.query(sql);
      columns = result.columns;
      rows = result.rows.map(row => columns.map(c => {
        const value = row[c];
        if (value instanceof Date) return value.toISOString();
        if (typeof value === "bigint") return Number(value);
        return value === undefined ? null : value;
      }));
      break;
    } catch (err) {
      errorContext = err?.message || String(err);
      finalError = errorContext;
      if (attempt === MAX_AGENT_ATTEMPTS) {
        return {sql,summary:"",columns:[],rows:[],row_count:0,truncated,limit_note,chart_suggestion:null,error:`Analysis failed after ${MAX_AGENT_ATTEMPTS} attempts: ${finalError}`};
      }
    }
  }

  return {
    sql,
    summary: await summarize(question, columns, rows),
    columns,
    rows,
    row_count: rows.length,
    truncated,
    limit_note,
    chart_suggestion: chartSuggestion(question, columns, rows),
    error: null
  };
}
