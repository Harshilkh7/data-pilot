import "dotenv/config";

export const PORT = Number(process.env.PORT || 8000);
export const DATABASE_URL = process.env.DATABASE_URL || "sqlite:///./ecommerce.db";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.7-flash,gemini-3.6-flash")
  .split(",").map(s => s.trim()).filter(Boolean).filter(m => m !== GEMINI_MODEL);
export const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
export const ALLOWED_ORIGINS = [...new Set([FRONTEND_ORIGIN, "http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"])];
export const READ_ONLY_MODE = /^(1|true|yes)$/i.test(process.env.READ_ONLY_MODE || "false");
export const READ_ONLY_DATABASE_URL = process.env.READ_ONLY_DATABASE_URL || "";
export const DEFAULT_ROW_LIMIT = Number(process.env.DEFAULT_ROW_LIMIT || 500);
export const ALL_ROWS_LIMIT = Number(process.env.ALL_ROWS_LIMIT || 10000);
export const MAX_AGENT_ATTEMPTS = Number(process.env.MAX_AGENT_ATTEMPTS || 3);
