// MCP-сервер Metro Rush. OpenCode запускает его сам (см. opencode.json → mcp.metro-rush)
// и общается через stdin/stdout. Даёт агенту один инструмент — simulate_run.

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const require = createRequire(import.meta.url);
const { simulateRun, MAX_SECONDS } = require("./simulate.js");

const server = new McpServer({ name: "metro-rush", version: "1.0.0" });

server.registerTool(
  "simulate_run",
  {
    title: "Прогнать заезд Metro Rush",
    description:
      "Прогоняет заезд Metro Rush без браузера на настоящей игровой логике (game.js) и возвращает итог: " +
      "доехал или разбился (обо что, на какой секунде), дистанция, очки, монеты, скорость, " +
      "все переключения передач с оценкой (perfect/good/early/late/overrev). " +
      "Одинаковый seed — одинаковая трасса, поэтому результат воспроизводим. " +
      "Полезно, чтобы проверить игровую логику, баланс КПП или проходимость трассы без запуска игры. " +
      `Команды: left, right, jump, gearUp, gearDown, nitro, none. seconds — до ${MAX_SECONDS}. ` +
      "autopilot=true — простой бот: уходит от поездов, прыгает через барьеры, переключается на высоких оборотах; " +
      "он не идеален и примерно в 1 заезде из 5 разбивается за 30 с.",
    inputSchema: {
      seed: z.number().int().describe("Seed трассы (целое число)"),
      seconds: z.number().describe(`Сколько секунд ехать, (0, ${MAX_SECONDS}]`),
      actions: z
        .array(
          z.object({
            t: z.number().describe("Секунда заезда, когда выполнить команду"),
            cmd: z.string().describe("Команда игрока"),
          })
        )
        .default([])
        .describe("Команды игрока по времени, например [{ t: 1.2, cmd: 'gearUp' }]"),
      autopilot: z.boolean().default(false).describe("Включить бота-автопилота"),
    },
  },
  async (args) => {
    try {
      const result = simulateRun(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      // Ошибочный вход: возвращаем понятную ошибку агенту, сервер продолжает работать.
      return {
        isError: true,
        content: [{ type: "text", text: `Ошибка входа (${err.name}): ${err.message}` }],
      };
    }
  }
);

await server.connect(new StdioServerTransport());
