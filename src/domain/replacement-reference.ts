import { normalizeSearchText } from "./text-matching.js";

// Explicit name aliases only: surname similarity is not identity evidence.
const nameAliases: readonly (readonly string[])[] = [
  ["凯恩", "哈里凯恩", "哈里·凯恩", "Harry Kane"],
  ["诺伊尔", "曼努埃尔诺伊尔", "曼努埃尔·诺伊尔", "Manuel Neuer"],
];

export function replacementTargetMention(messages: readonly string[]): string | undefined {
  let target: string | undefined;
  for (const message of messages) {
    const match = message.match(/(?:寻找|找|招募)\s*([^，。！？；,!?;]{1,60}?)\s*的(?:替代者|接班人|替补)/i)
      ?? message.match(/(?:replacement|successor|backup)\s+for\s+([^,.;!?]+?)(?:\s+(?:who|with|for)\b|[,.;!?]|$)/i)
      ?? message.match(/([^,.;!?]+?)['’]s\s+(?:replacement|successor|backup)/i);
    if (match?.[1]) target = match[1].trim();
  }
  return target;
}

export function replacementTargetNames(messages: readonly string[]): string[] {
  const target = replacementTargetMention(messages);
  if (!target) return [];
  const normalized = normalizeSearchText(target);
  const aliases = nameAliases.find((group) => group.some((name) => normalizeSearchText(name) === normalized));
  return [...new Set((aliases ?? [target]).map(normalizeSearchText))];
}

export function isReplacementTarget(name: string, targets: readonly string[]): boolean {
  return targets.includes(normalizeSearchText(name));
}

/** A new named reference starts a new role brief while explicit non-role constraints can persist. */
export function activeReferenceMessages(messages: readonly string[]): readonly string[] {
  let reference: string | undefined;
  let start = 0;
  for (const [index, message] of messages.entries()) {
    const mention = replacementTargetMention([message]);
    if (mention && reference && normalizeSearchText(mention) !== normalizeSearchText(reference)) start = index;
    if (mention) reference = mention;
  }
  return messages.slice(start);
}
