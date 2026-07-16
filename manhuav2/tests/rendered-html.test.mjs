import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the mobile comic creator shell", async () => {
  const [client, layout] = await Promise.all([
    readFile(new URL("../app/creator-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(client, /画芽/);
  assert.match(layout, /儿童漫画创作/);
  assert.match(client, /我的漫画主角/);
  assert.match(client, /主角类型/);
  assert.match(client, /补充设定/);
  assert.match(client, /机器人主角/);
  assert.match(client, /主角类型未记录/);
  assert.match(client, /今天去哪里冒险/);
  assert.match(client, /comic-creator\.webp/);
  assert.doesNotMatch(client, /Your site is taking shape|react-loading-skeleton/);
});

test("keeps model credentials server-side", async () => {
  const [client, route, generation, example] = await Promise.all([
    readFile(new URL("../app/creator-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/generation.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(client, /DASHSCOPE_API_KEY|cn-beijing\.maas/);
  assert.match(route, /referenceKey/);
  assert.match(route, /rewriteQueryWithContext/);
  assert.match(route, /MODEL_NOT_CONFIGURED/);
  assert.doesNotMatch(route, /mode:\s*["']demo["']/);
  assert.doesNotMatch(client, /demo-scene/);
  assert.match(generation, /创作一张温暖、明亮、家庭友好的绘本漫画插图/);
  assert.match(generation, /画面焦点：一位完整的原创卡通机器人主角/);
  assert.match(generation, /主体类型尚未指定时/);
  assert.match(generation, /本次创作一幅全新场景/);
  assert.match(generation, /本次以参考图为基础进行局部更新/);
  assert.match(generation, /本次以参考图中的主角外观为基础/);
  assert.match(generation, /n: candidateCount/);
  assert.match(generation, /buildRefinementPrompt/);
  assert.match(client, /绘制两张初稿/);
  assert.match(generation, /固定安全规则中的禁用词不得作为违规证据/);
  assert.doesNotMatch(generation, /validateChildSafeText/);
  assert.match(client, /const skip = \(\) =>/);
  assert.match(client, /Math\.min\(step, steps\.length - 1\)/);
  assert.match(client, /仍然按当前描述生成/);
  assert.match(client, /allowIncomplete/);
  assert.match(example, /DASHSCOPE_API_KEY=\s*$/m);
  assert.doesNotMatch(example, /sk-[A-Za-z0-9]/);
});
