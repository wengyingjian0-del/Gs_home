import { env } from "@/lib/runtime-env";
import { Buffer } from "node:buffer";

type ArtworkBucket = { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> };
type Bindings = { ARTWORKS?: ArtworkBucket };

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!JOB_ID_PATTERN.test(id)) return Response.json({ message: "任务编号无效" }, { status: 400 });
  const bucket = (env as unknown as Bindings).ARTWORKS;
  if (!bucket) return Response.json({ message: "进度服务未配置" }, { status: 503 });
  const object = await bucket.get(`jobs/${id}.json`);
  if (!object) return Response.json({ status: "starting", stage: "starting", label: "正在启动生成任务" }, { status: 404 });
  try {
    return Response.json(JSON.parse(Buffer.from(await object.arrayBuffer()).toString("utf8")));
  } catch {
    return Response.json({ message: "进度信息暂时不可读" }, { status: 502 });
  }
}
