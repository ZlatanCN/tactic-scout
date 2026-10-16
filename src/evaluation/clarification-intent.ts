import type { ConversationTurnResponse } from "../domain/conversation.js";
import type { ClarificationIntent } from "./harness-scenarios.js";

export function questionAddressesRoleAmbiguity(response: ConversationTurnResponse): boolean {
  const question = response.message;
  const asksAnotherDimension = /联赛|赛事|国籍|预算|年龄|身价|合同|薪资|市场/u.test(question);
  const addressesRole = /凯恩|替代者|接班人|替补|职责|角色|中锋|前锋|主力|首发|即战力|培养/u.test(question);
  const asksForAChoice = /还是|更偏向|优先|立即|即插即用|短期|长期|未来|潜力|培养|接班|主力|首发|哪种|什么样|什么类型/u.test(question);
  return !asksAnotherDimension && addressesRole && asksForAChoice;
}

/** Matches a scripted answer to the actual clarification asked by the graph. */
export function questionMatchesClarificationIntent(
  intent: ClarificationIntent,
  response: ConversationTurnResponse,
): boolean {
  if (intent === "role_preference") return questionAddressesRoleAmbiguity(response);
  const question = response.message;
  const mentionsPosition = /位置|中锋|前锋|边锋|中场|后卫|ST|ATT/u.test(question);
  const asksToBroaden = /扩大|扩展|放宽|其他.{0,8}(?:位置|前锋|范围)|范围.{0,8}(?:扩大|扩展|放宽)|是否接受.{0,12}(?:其他|更宽)/u.test(question);
  const asksAnotherDimension = /年龄|预算|身价|国籍|合同|薪资|联赛|赛事|赛季/u.test(question);
  return mentionsPosition && asksToBroaden && !asksAnotherDimension;
}
