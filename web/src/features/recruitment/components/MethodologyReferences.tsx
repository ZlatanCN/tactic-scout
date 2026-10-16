import { type MethodologySourceReference } from "../../../../../src/domain/reports.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export function MethodologyReferences({ sources }: { sources: MethodologySourceReference[] }) {
  if (sources.length === 0) return null;

  return (
    <Card size="sm" className="gap-2 py-3">
      <CardHeader className="flex flex-row items-center justify-between px-3 py-0"><CardTitle className="text-xs">本轮方法来源</CardTitle><Badge variant="outline">{sources.length}</Badge></CardHeader>
      <CardContent className="px-3">
      <ul className="m-0 list-none space-y-2 p-0">
        {sources.map((source) => (
          <li className="rounded-md bg-muted/40 p-2.5 text-xs" key={source.url}>
            <a className="font-medium text-primary underline underline-offset-4" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            <span className="mt-1 block leading-5 text-muted-foreground">
              {source.author} · {source.publisher}{source.publishedAt ? ` · ${source.publishedAt.slice(0, 4)}` : ""}
            </span>
            <small className="mt-1 block leading-5 text-muted-foreground">{source.attribution}</small>
            <span className="mt-1 block text-[11px] text-muted-foreground">许可：{source.license}</span>
          </li>
        ))}
      </ul>
      </CardContent>
    </Card>
  );
}
