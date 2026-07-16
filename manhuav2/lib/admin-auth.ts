import { env } from "cloudflare:workers";

export const ADMIN_COOKIE = "huaya_admin_session";

export function getAdminAccessToken() {
  const runtime = env as unknown as Record<string, string | undefined>;
  return (runtime.ADMIN_ACCESS_TOKEN || process.env.ADMIN_ACCESS_TOKEN || "").trim();
}

export async function hashAdminAccessToken(token: string) {
  const bytes = new TextEncoder().encode(`huaya-admin-v1:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export async function adminSessionIsValid(cookieValue?: string) {
  const token = getAdminAccessToken();
  if (!token || !cookieValue) return false;
  return cookieValue === await hashAdminAccessToken(token);
}
