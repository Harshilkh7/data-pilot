import { GoogleGenAI } from "@google/genai";
import { ChromaClient, CloudClient } from "chromadb";
import { getSession } from "./database.js";
import {
  GEMINI_API_KEY,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_EMBEDDING_DIMENSIONS,
  CHROMA_URL,
  CHROMA_TENANT,
  CHROMA_DATABASE,
  CHROMA_API_KEY,
  CHROMA_AUTH_TOKEN,
  RAG_TOP_K,
  RAG_SKIP_THRESHOLD,
} from "./config.js";

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
let chromaClient = null;
const localIndexes = new Map();

function collectionName(sessionId) {
  return `schema-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50)}`;
}

function getChromaClient() {
  if (chromaClient) return chromaClient;
  if (CHROMA_API_KEY) {
    chromaClient = new CloudClient({ apiKey: CHROMA_API_KEY, tenant: CHROMA_TENANT, database: CHROMA_DATABASE });
  } else {
    chromaClient = new ChromaClient({
      path: CHROMA_URL,
      tenant: CHROMA_TENANT,
      database: CHROMA_DATABASE,
      headers: CHROMA_AUTH_TOKEN ? { Authorization: `Bearer ${CHROMA_AUTH_TOKEN}` } : undefined,
    });
  }
  return chromaClient;
}

async function embedTexts(texts) {
  if (!texts.length) return [];
  if (!ai) throw new Error("GEMINI_API_KEY is not configured; semantic schema retrieval cannot run.");
  const response = await ai.models.embedContent({ model: GEMINI_EMBEDDING_MODEL, contents: texts, config: { outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS } });
  return (response.embeddings || []).map(item => item.values || []);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function describeTable(table) {
  const fkMap = new Map((table.foreign_keys || []).map(fk => [fk.column, fk]));
  const columns = table.columns.map(col => {
    let tag = "";
    if (col.primary_key) tag = ", PK";
    else if (fkMap.has(col.name)) tag = `, FK→${fkMap.get(col.name).references_table}`;
    return `${col.name} (${col.type}${tag})`;
  }).join(", ");
  const relationships = (table.foreign_keys || []).map(fk => `${fk.column} references ${fk.references_table}(${fk.references_column})`).join("; ");
  return `${table.name}: contains ${columns} — a table in the database schema. ${relationships ? `Relationships: ${relationships}.` : ""}`;
}

export function schemaToSqlDdl(tables) {
  return tables.map(t => {
    const lines = [`Table: ${t.name}`];
    for (const col of t.columns) {
      const tags = [];
      if (col.primary_key) tags.push("PK");
      if (!col.nullable) tags.push("NOT NULL");
      lines.push(`  ${col.name} ${col.type}${tags.length ? ` [${tags.join(", ")}]` : ""}`);
    }
    for (const fk of t.foreign_keys || []) lines.push(`  FK: ${fk.column} → ${fk.references_table}(${fk.references_column})`);
    lines.push("--");
    return lines.join("\n");
  }).join("\n");
}

function buildLocalIndex(tables, embeddings, descriptions) {
  return tables.map((table, i) => ({ table, description: descriptions[i], embedding: embeddings[i] }));
}

async function tryChromaIndex(sessionId, tables, descriptions, embeddings) {
  const client = getChromaClient();
  const name = collectionName(sessionId);
  try { await client.deleteCollection({ name }); } catch {}
  const collection = await client.createCollection({
    name,
    metadata: { "hnsw:space": "cosine" },
    embeddingFunction: null,
  });
  await collection.add({ ids: tables.map(t => t.name), documents: descriptions, embeddings, metadatas: tables.map(t => ({ table_name: t.name })) });
  return { provider: "chroma", collection };
}

export async function indexSchema(sessionId) {
  const session = getSession(sessionId);
  const tables = session.schemas;
  if (!tables.length) return { indexed: 0, provider: "none" };

  const descriptions = tables.map(describeTable);

  // Small schemas are passed to Gemini in full anyway. Do not spend an
  // embedding request or depend on a sleeping/free Chroma service for them.
  if (tables.length <= RAG_SKIP_THRESHOLD) {
    localIndexes.set(sessionId, { provider: "full-schema", tables, descriptions, embeddings: [] });
    console.log(`RAG: ${tables.length} tables <= threshold ${RAG_SKIP_THRESHOLD}; indexing skipped because full schema is used.`);
    return { indexed: tables.length, provider: "full-schema" };
  }

  if (!GEMINI_API_KEY) {
    localIndexes.set(sessionId, { provider: "unavailable", tables, descriptions, embeddings: [] });
    return { indexed: tables.length, provider: "unavailable" };
  }

  let embeddings;
  try {
    embeddings = await embedTexts(descriptions);
  } catch (error) {
    console.warn(`RAG: embedding unavailable (${error.message}); falling back to full schema.`);
    localIndexes.set(sessionId, { provider: "full-schema-fallback", tables, descriptions, embeddings: [] });
    return { indexed: tables.length, provider: "full-schema-fallback" };
  }

  try {
    const result = await tryChromaIndex(sessionId, tables, descriptions, embeddings);
    localIndexes.set(sessionId, buildLocalIndex(tables, embeddings, descriptions));
    console.log(`RAG: indexed ${tables.length} tables in Chroma for ${sessionId}`);
    return { indexed: tables.length, provider: result.provider };
  } catch (error) {
    console.warn(`RAG: Chroma unavailable (${error.message}); using in-process semantic vector index.`);
    localIndexes.set(sessionId, buildLocalIndex(tables, embeddings, descriptions));
    return { indexed: tables.length, provider: "local-vector-fallback" };
  }
}

export async function retrieveRelevantTables(sessionId, question, fullSchema) {
  if (fullSchema.length <= RAG_SKIP_THRESHOLD) {
    console.log(`RAG: ${fullSchema.length} tables <= threshold ${RAG_SKIP_THRESHOLD}; using full schema.`);
    return fullSchema;
  }

  const index = localIndexes.get(sessionId);
  if (!GEMINI_API_KEY) return fullSchema;

  let queryEmbedding;
  try {
    queryEmbedding = (await embedTexts([question]))[0];
    const name = collectionName(sessionId);
    const collection = await getChromaClient().getCollection({ name, embeddingFunction: null });
    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.min(RAG_TOP_K, fullSchema.length),
      include: ["metadatas", "distances"],
    });

    const names = new Set();
    for (const list of result.metadatas || []) {
      for (const meta of list || []) {
        if (meta?.table_name) names.add(meta.table_name);
      }
    }

    const selected = fullSchema.filter(t => names.has(t.name));
    if (selected.length) {
      console.log(`RAG: retrieved ${selected.length} tables from Chroma: ${[...names].join(", ")}`);
      return selected;
    }
  } catch (error) {
    console.warn(`RAG: semantic retrieval unavailable (${error.message}); using local/full schema fallback.`);
  }

  if (!index || !index.embeddings?.length) return fullSchema;

  return index
    .map(item => ({ ...item, score: cosine(queryEmbedding, item.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(RAG_TOP_K, index.length))
    .map(item => item.table);
}

export async function removeSchemaIndex(sessionId) {
  localIndexes.delete(sessionId);
  if (!chromaClient) return;
  try { await chromaClient.deleteCollection({ name: collectionName(sessionId) }); } catch {}
}
