export function shortDatasetId(datasetId: string): string {
  const digest = datasetId.match(/-([a-f\d]{12})-/i)?.[1];
  const schemaVersion = datasetId.match(/-v(\d+)-/i)?.[1];
  const eventRulesetVersion = datasetId.match(/-tactiscout-wyscout-events-v(\d+)$/i)?.[1];
  const parts = [
    schemaVersion ? `格式 v${schemaVersion}` : null,
    eventRulesetVersion ? `指标规则 events v${eventRulesetVersion}` : null,
    digest,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : datasetId;
}
