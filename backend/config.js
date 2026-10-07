import "dotenv/config";

export const PORT = Number(process.env.PORT || 8000);
export const DATABASE_URL = process.env.DATABASE_URL || "sqlite:///./ecommerce.db";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
export const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "")
  .split(",").map(s => s.trim()).filter(Boolean).filter(m => m !== GEMINI_MODEL);

export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
export const GEMINI_EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);

export const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8001";
export const CHROMA_TENANT = process.env.CHROMA_TENANT || "default_tenant";
export const CHROMA_DATABASE = process.env.CHROMA_DATABASE || "default_database";
export const CHROMA_API_KEY = process.env.CHROMA_API_KEY || "";
export const CHROMA_AUTH_TOKEN = process.env.CHROMA_AUTH_TOKEN || "";
export const RAG_TOP_K = Number(process.env.RAG_TOP_K || 5);
export const RAG_SKIP_THRESHOLD = Number(process.env.RAG_SKIP_THRESHOLD || 10);

export const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
export const ALLOWED_ORIGINS = [...new Set([FRONTEND_ORIGIN, "http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"])];

export const READ_ONLY_MODE = /^(1|true|yes)$/i.test(process.env.READ_ONLY_MODE || "false");
export const READ_ONLY_DATABASE_URL = process.env.READ_ONLY_DATABASE_URL || "";
export const DEFAULT_ROW_LIMIT = Number(process.env.DEFAULT_ROW_LIMIT || 500);
export const ALL_ROWS_LIMIT = Number(process.env.ALL_ROWS_LIMIT || 10000);
export const MAX_AGENT_ATTEMPTS = Number(process.env.MAX_AGENT_ATTEMPTS || 2);
