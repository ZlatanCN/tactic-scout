import { randomBytes } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportBlindedReviewPackets } from "./blinded-review-packet.js";
import { createReviewRequestFromHarnessRun } from "./harness-review-request.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const help = [
  "Usage:",
  "  pnpm export:shortlist-review --snapshot <snapshot.json> --request <request.json> --reviewer-packet <packet.json> --answer-key <key.json>",
  "  pnpm export:shortlist-review --snapshot <snapshot.json> --evaluation <harness-output.json> --review-context <context.json> --reviewer-packet <packet.json> --answer-key <key.json>",
  "",
  "The CLI reads only local files, makes no provider/model calls, and refuses to overwrite either output.",
  "Harness mode accepts one current, fully passing run and ranks only recommendations present in its report.",
].join("\n");

interface CliPaths {
  snapshot: string;
  request?: string;
  evaluation?: string;
  reviewContext?: string;
  reviewerPacket: string;
  answerKey: string;
}

function parseArguments(args: string[]): CliPaths | null {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return null;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) throw new Error(help);
    if (values.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    values.set(flag, value);
  }
  const hasRequest = values.has("--request");
  const hasEvaluation = values.has("--evaluation");
  const hasReviewContext = values.has("--review-context");
  const validInput = hasRequest
    ? !hasEvaluation && !hasReviewContext
    : hasEvaluation && hasReviewContext;
  const expectedFlags = ["--snapshot", "--reviewer-packet", "--answer-key"];
  if (!validInput || expectedFlags.some((flag) => !values.has(flag))) throw new Error(help);
  if (values.size !== expectedFlags.length + (hasRequest ? 1 : 2)) throw new Error(help);
  return {
    snapshot: path.resolve(process.cwd(), values.get("--snapshot")!),
    ...(hasRequest ? { request: path.resolve(process.cwd(), values.get("--request")!) } : {
      evaluation: path.resolve(process.cwd(), values.get("--evaluation")!),
      reviewContext: path.resolve(process.cwd(), values.get("--review-context")!),
    }),
    reviewerPacket: path.resolve(process.cwd(), values.get("--reviewer-packet")!),
    answerKey: path.resolve(process.cwd(), values.get("--answer-key")!),
  };
}

async function writeOutputPair(paths: CliPaths, reviewerPacket: string, answerKey: string): Promise<void> {
  if (paths.reviewerPacket === paths.answerKey) throw new Error("评审包和答案键必须写入不同文件。");
  let reviewerPacketWriteAttempted = false;
  let reviewerPacketCreated = false;
  let answerKeyWriteAttempted = false;
  try {
    reviewerPacketWriteAttempted = true;
    await writeFile(paths.reviewerPacket, reviewerPacket, { encoding: "utf8", flag: "wx", mode: 0o600 });
    reviewerPacketCreated = true;
    answerKeyWriteAttempted = true;
    await writeFile(paths.answerKey, answerKey, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (answerKeyWriteAttempted && code !== "EEXIST") await unlink(paths.answerKey).catch(() => undefined);
    if (reviewerPacketCreated || (reviewerPacketWriteAttempted && code !== "EEXIST")) {
      await unlink(paths.reviewerPacket).catch(() => undefined);
    }
    if (code === "EEXIST") {
      throw new Error("输出文件已存在，拒绝覆盖。请选择新的评审包和答案键路径。");
    }
    throw new Error("无法写入盲评文件；请确认目标目录存在且可写。", { cause: error });
  }
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const paths = parseArguments(args);
  if (!paths) {
    process.stdout.write(`${help}\n`);
    return;
  }
  const [snapshotJson, requestJson, evaluationJson, reviewContextJson] = await Promise.all([
    readFile(paths.snapshot, "utf8"),
    paths.request ? readFile(paths.request, "utf8") : Promise.resolve(undefined),
    paths.evaluation ? readFile(paths.evaluation, "utf8") : Promise.resolve(undefined),
    paths.reviewContext ? readFile(paths.reviewContext, "utf8") : Promise.resolve(undefined),
  ]);
  let request: unknown;
  if (requestJson !== undefined) {
    try {
      request = JSON.parse(requestJson) as unknown;
    } catch {
      throw new Error("盲评请求不是有效 JSON。");
    }
  } else {
    let reviewContext: unknown;
    try {
      reviewContext = JSON.parse(reviewContextJson!) as unknown;
    } catch {
      throw new Error("盲评上下文不是有效 JSON。");
    }
    request = createReviewRequestFromHarnessRun({
      evaluationJson: evaluationJson!,
      snapshotJson,
      context: reviewContext,
    });
  }
  const { reviewerPacket, answerKey } = exportBlindedReviewPackets({
    snapshotJson,
    request,
    blindingSecret: randomBytes(32).toString("hex"),
  });
  await writeOutputPair(
    paths,
    `${JSON.stringify(reviewerPacket, null, 2)}\n`,
    `${JSON.stringify(answerKey, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({
    packetId: reviewerPacket.packetId,
    snapshotSha256: reviewerPacket.snapshot.sha256,
    reviewerPacketPath: path.relative(projectRoot, paths.reviewerPacket),
    answerKeyPath: path.relative(projectRoot, paths.answerKey),
    cardCount: reviewerPacket.cards.length,
    sourceRecordCount: answerKey.cards.reduce((count, card) => count + card.sourcePlayerIds.length, 0),
  }, null, 2)}\n`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "盲评包导出失败。";
  console.error(message);
  process.exitCode = 2;
}
