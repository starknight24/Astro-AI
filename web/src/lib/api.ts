// Production: VITE_API_URL is set at build time (Vercel dashboard).
// Dev: empty string → relative URLs → vite.config.ts proxy handles it.
export const API_URL: string = import.meta.env.VITE_API_URL ?? "";
