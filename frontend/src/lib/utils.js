import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) { return twMerge(clsx(inputs)); }
export function formatNumber(n) { return new Intl.NumberFormat().format(n); }
export function formatMs(ms) { return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`; }
export function generateId() { return Math.random().toString(36).slice(2,10); }
export function truncate(str,max) { return str.length <= max ? str : str.slice(0,max) + "…"; }
