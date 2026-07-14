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
  assert.match(generation, /规则优先级高于画面美观度/);
  assert.match(generation, /最高优先级强制角色锁定规则/);
  assert.match(generation, /本次全新场景生成需求/);
  assert.match(generation, /本次仅局部微调/);
  assert.match(generation, /本次为重绘全新创作分支/);
  assert.match(generation, /固定安全规则中的禁用词不得作为违规证据/);
  assert.doesNotMatch(generation, /validateChildSafeText/);
  assert.match(client, /const skip = \(\) =>/);
  assert.match(example, /DASHSCOPE_API_KEY=\s*$/m);
  assert.doesNotMatch(example, /sk-[A-Za-z0-9]/);
});
