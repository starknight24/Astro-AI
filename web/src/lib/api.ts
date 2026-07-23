import { supabase } from "./supabase";

// Production: VITE_API_URL is set at build time (Vercel dashboard).
// Dev: empty string → relative URLs → vite.config.ts proxy handles it.
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "").trim();

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(`${API_URL}${path}`, { ...init, headers });
}
