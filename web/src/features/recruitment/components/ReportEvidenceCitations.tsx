import type { ReportEvidenceCitation } from "../../../../../src/domain/reports.js";

export function ReportEvidenceCitations({ citations }: { citations: readonly ReportEvidenceCitation[] }) {
  if (!citations.length) return null;
  return <ul className="m-0 list-none space-y-3 border-l-2 pl-3">
    {citations.map((citation) => <li key={[citation.evidenceRef.documentRevisionId, citation.evidenceRef.sectionId, citation.evidenceRef.startOffset].join(":")} className="min-w-0 space-y-1">
      <small className="block break-words text-muted-foreground">{citation.sectionPath.join(" / ") || "原文片段"}</small>
      <blockquote className="m-0 border-l-2 pl-3 text-xs leading-5 text-muted-foreground">{citation.excerpt}</blockquote>
      {(citation.competition || citation.season || citation.observedFrom || citation.observedTo || citation.sampleSummary) && <small className="block break-words text-muted-foreground">{[
        citation.competition,
        citation.season,
        citation.observedFrom && citation.observedTo ? citation.observedFrom + "–" + citation.observedTo : null,
        citation.sampleSummary,
      ].filter(Boolean).join(" · ")}</small>}
      <a className="break-words text-xs text-primary underline underline-offset-4" href={citation.source.url} target="_blank" rel="noreferrer">
        {citation.source.title} · {citation.source.author} · {citation.source.publisher} · {citation.source.license}
      </a>
      <small className="block break-words text-muted-foreground">{citation.source.attribution}</small>
    </li>)}
  </ul>;
}
