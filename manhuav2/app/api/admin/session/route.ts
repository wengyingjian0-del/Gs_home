import { ADMIN_COOKIE, getAdminAccessToken, hashAdminAccessToken } from "@/lib/admin-auth";

export async function POST(request: Request) {
  const configuredToken = getAdminAccessToken();
  if (!configuredToken) return Response.json({ message: "管理员入口尚未配置。请先设置 ADMIN_ACCESS_TOKEN。" }, { status: 503 });
  let accessCode = "";
  try { accessCode = String((await request.json() as { accessCode?: string }).accessCode || ""); }
  catch { return Response.json({ message: "请输入管理员访问口令。" }, { status: 400 }); }
  const [expected, actual] = await Promise.all([hashAdminAccessToken(configuredToken), hashAdminAccessToken(accessCode)]);
  if (actual !== expected) return Response.json({ message: "访问口令不正确。" }, { status: 401 });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${ADMIN_COOKIE}=${expected}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` } });
}

export async function DELETE(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` } });
}
