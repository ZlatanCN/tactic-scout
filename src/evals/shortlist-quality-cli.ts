import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateShortlistQuality } from "./shortlist-quality-evaluation.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templatePath = path.join(projectRoot, "data", "evaluations", "human-shortlist-quality-v1.template.json");
const help = [
  "用法：",
  "  pnpm eval:shortlist-quality [evaluation.json]",
  "",
  "不传路径时读取空模板，并返回 not_evaluable；传入文件时只读取本地 JSON，不调用模型或数据源。",
].join("\n");

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    if (args.length !== 1) throw new Error("--help 不能与其他参数一起使用。");
    process.stdout.write(`${help}\n`);
    return;
  }
  if (args.length > 1) throw new Error(help);
  const inputPath = args[0] ? path.resolve(process.cwd(), args[0]) : templatePath;
  const input = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  const result = evaluateShortlistQuality(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "短名单质量评测失败。";
  console.error(message);
  process.exitCode = 2;
}
