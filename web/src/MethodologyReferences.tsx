import type { MethodologySourceReference } from "../../src/domain/schemas.js";

export function MethodologyReferences({ sources }: { sources: MethodologySourceReference[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="methodology-references">
      <span className="methodology-references-heading">本轮方法来源 · {sources.length}</span>
      <ul>
        {sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            <span className="methodology-reference-meta">
              {source.author} · {source.publisher}{source.publishedAt ? ` · ${source.publishedAt.slice(0, 4)}` : ""}
            </span>
            <small>{source.attribution}</small>
            <span className="methodology-reference-license">许可：{source.license}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
