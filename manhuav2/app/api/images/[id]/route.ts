import { env } from "@/lib/runtime-env";

type StoredObject = { body: ReadableStream; httpMetadata?: { contentType?: string }; writeHttpMetadata?(headers: Headers): void };
type Bucket = { get(key: string): Promise<StoredObject | null> };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]+\.png$/.test(id)) return new Response("Not found", { status: 404 });
  const bucket = (env as unknown as { ARTWORKS?: Bucket }).ARTWORKS;
  if (!bucket) return new Response("Storage unavailable", { status: 503 });
  const object = await bucket.get(`generated/${id}`);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers({ "Cache-Control": "private, max-age=3600", "Content-Type": object.httpMetadata?.contentType || "image/png", "X-Content-Type-Options": "nosniff" });
  object.writeHttpMetadata?.(headers);
  return new Response(object.body, { headers });
}
