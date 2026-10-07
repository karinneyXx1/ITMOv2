// Проверка MCP-сервера по настоящему протоколу: клиент SDK запускает server.mjs
// как отдельный процесс (так же, как OpenCode) и вызывает инструмент.
// Запуск: node mcp/test_server.mjs

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function connect() {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: "node", args: [path.join(here, "server.mjs")] }));
  return client;
}

test("сервер объявляет инструмент simulate_run", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["simulate_run"]);
  await client.close();
});

test("успешный вызов: возвращает итог заезда в JSON", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "simulate_run",
    arguments: { seed: 42, seconds: 10, actions: [{ t: 1.1, cmd: "gearUp" }] },
  });
  assert.notEqual(res.isError, true);
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.seed, 42);
  assert.equal(data.shifts[0].quality, "perfect");
  await client.close();
});

test("ошибочный вход: неизвестная команда → isError с понятным текстом, сервер жив", async () => {
  const client = await connect();
  const bad = await client.callTool({
    name: "simulate_run",
    arguments: { seed: 42, seconds: 10, actions: [{ t: 1, cmd: "turbo" }] },
  });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /actions\[0\]\.cmd: unknown command: "turbo"/);
  // после ошибки сервер продолжает отвечать
  const ok = await client.callTool({ name: "simulate_run", arguments: { seed: 1, seconds: 1 } });
  assert.notEqual(ok.isError, true);
  await client.close();
});

test("ошибочный вход по схеме: seed строкой → isError", async () => {
  const client = await connect();
  const bad = await client.callTool({ name: "simulate_run", arguments: { seed: "abc", seconds: 5 } });
  assert.equal(bad.isError, true);
  await client.close();
});
