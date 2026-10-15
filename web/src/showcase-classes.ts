const showcaseBase = "[&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:sm:text-4xl [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:text-base [&_h3]:font-semibold [&_p]:leading-6 [&_small]:leading-5 [&_code]:break-all";

function resolveShowcaseClass(key: string): string {
  if (!key) return "";
  if (key === "showcase-shell") return "min-h-screen bg-background";
  if (key === "showcase-main") return "mx-auto w-full max-w-7xl space-y-8 px-4 py-7 sm:px-6 sm:py-10";
  if (key.includes("topbar")) return "border-b bg-card/90";
  if (key === "brand") return "flex items-center gap-2 font-semibold tracking-tight";
  if (key === "showcase-recorded-pill") return "inline-flex items-center gap-2 rounded-full border bg-secondary px-3 py-1 text-xs font-medium text-primary";
  if (key === "showcase-return-link") return "inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline";
  if (key.includes("footer")) return "mx-auto flex w-full max-w-7xl flex-wrap justify-between gap-2 border-t px-4 py-5 text-xs text-muted-foreground sm:px-6";
  if (/^showcase-(ask-policy|clarification|evaluator-ablation|latency|planning-ablation|rag-ablation|reviewer-ablation|workflow)$/.test(key)) return `${showcaseBase} min-w-0 space-y-5`;
  if (/^story-(executive-hero|timeline-hero|dossier-heading)$/.test(key)) return "grid items-start gap-6 border-b pb-6 lg:grid-cols-[minmax(0,1fr)_16rem]";
  if (key === "story-timeline-rail") return "grid content-start gap-3 [&>div]:rounded-lg [&>div]:border [&>div]:bg-card [&>div]:p-3 [&>div>strong]:block [&>div>strong]:text-2xl [&>div>strong]:tabular-nums [&>div>span]:block [&>div>span]:text-sm [&>div>small]:block [&>div>small]:text-xs [&>div>small]:text-muted-foreground";
  if (key === "story-lead") return "space-y-3 rounded-lg border border-primary/20 bg-secondary/50 p-4 [&>span]:text-xs [&>span]:text-muted-foreground [&>strong]:block [&>strong]:text-lg [&_div]:flex [&_div]:gap-2 [&_div_b]:rounded-full [&_div_b]:bg-background [&_div_b]:px-2.5 [&_div_b]:py-1 [&_div_b]:text-xs [&_p]:m-0 [&_p]:text-xs [&_p]:text-muted-foreground";
  if (key === "story-tabbed-studies" || key === "story-experiments" || key === "story-dossier-studies") return "min-w-0 space-y-4";
  if (key === "story-dossier-rule") return "flex items-start gap-4 border-t pt-5 [&>span]:inline-flex [&>span]:size-9 [&>span]:shrink-0 [&>span]:items-center [&>span]:justify-center [&>span]:rounded-full [&>span]:bg-secondary [&>span]:text-sm [&>span]:font-semibold [&>span]:text-primary";
  if (key === "story-next") return "flex flex-wrap items-center justify-between gap-4 rounded-lg border border-primary/20 bg-secondary/40 p-4 sm:p-5 [&>a]:inline-flex [&>a]:items-center [&>a]:gap-2 [&>a]:font-medium [&>a]:text-primary [&>a]:underline-offset-4 hover:[&>a]:underline";
  if (key === "story-source-links") return "flex flex-wrap gap-x-4 gap-y-2 text-sm [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline";
  if (key === "latency-operation-label") return "grid min-w-0 gap-1 text-xs [&_code]:font-mono [&_small]:text-muted-foreground";
  if (key === "rag-crosslingual-results") return "space-y-3";
  if (key.includes("eyebrow") || key.includes("kicker") || key === "eyebrow") return "text-xs font-medium tracking-wide text-muted-foreground";
  if (key.includes("lead-copy")) return "min-w-0 space-y-2";
  if (key.includes("lead") || key.includes("heading")) return "flex flex-wrap items-start justify-between gap-4 border-b pb-4";
  if (key.includes("proof") || key.includes("stamp") || key.includes("headline")) return "grid content-start gap-2 rounded-lg border bg-secondary p-4 [&_strong]:text-2xl [&_strong]:font-semibold [&_small]:text-xs [&_small]:text-muted-foreground";
  if (key.includes("shell")) return "min-w-0";
  if (key.includes("workflow-main")) return "grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]";
  if (key.includes("branches") || key.includes("scenarios") || key.includes("cases") || key.includes("case-grid") || key.includes("arms") || key.includes("breakdown") || key.includes("executive-grid") || key.includes("timeline-layout") || key.includes("run-facts") || key.includes("metric-grid") || key.includes("distribution")) return "grid min-w-0 gap-4 md:grid-cols-2";
  if (key.includes("workflow-node") || key.includes("workflow-branch") || key.includes("scenario") || key.includes("-case") || key.includes("-arm") || key.includes("operation-group") || key.includes("investigation") || key.includes("story-outcome") || key.includes("timeline-main") || key.includes("active-study")) return "min-w-0 rounded-lg border bg-card p-4 sm:p-5";
  if (key.includes("workflow-arrow")) return "hidden items-center justify-center text-xl text-primary md:flex";
  if (key.includes("workflow-return")) return "flex items-center justify-center gap-2 py-1 text-sm text-muted-foreground";
  if (key.includes("workflow-review-outcomes") || key.includes("reviewer-scenario-facts") || key.includes("gap-summary")) return "grid gap-2 border-t pt-3 text-xs sm:grid-cols-2";
  if (key.includes("workflow-footnote") || key.includes("caveat") || key.includes("token-note") || key.includes("safety") || key.includes("footnote")) return "rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground";
  if (key.includes("method")) return "rounded-lg border bg-card px-4 py-3 text-sm [&_summary]:cursor-pointer [&_summary]:font-medium [&_div]:space-y-3 [&_div]:border-t [&_div]:pt-3 [&_p]:text-muted-foreground";
  if (key.includes("paths")) return "grid gap-3 md:grid-cols-2";
  if (key.includes("path")) return "rounded-md border bg-muted/40 p-3 [&_ol]:mt-2 [&_ol]:grid [&_ol]:gap-2 [&_ol]:sm:grid-cols-2 [&_li]:flex [&_li]:items-center [&_li]:gap-2 [&_li]:rounded-md [&_li]:bg-background [&_li]:p-2 [&_li]:text-xs";
  if (key.includes("track")) return "relative h-2 overflow-hidden rounded-full bg-muted [&_span]:block [&_span]:h-full [&_span]:rounded-full [&_span]:bg-primary";
  if (key.includes("operation-list") || key.includes("latency-runs")) return "space-y-3";
  if (key.includes("row") || key.includes("run") || key.includes("system")) return "grid min-w-0 items-center gap-3 rounded-md border p-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(5rem,2fr)_auto]";
  if (key.includes("label")) return "text-xs font-medium text-muted-foreground";
  if (key.includes("stats") || key.includes("facts") || key.includes("results")) return "grid min-w-0 gap-3 sm:grid-cols-2";
  if (key.includes("table-wrap") || key.includes("scroll")) return "overflow-x-auto rounded-md border";
  if (key.includes("table") || key === "rag-crosslingual-grid") return "w-full min-w-[36rem] border-collapse text-sm [&_caption]:p-3 [&_caption]:text-left [&_caption]:text-xs [&_th]:border-b [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-2 [&_td]:border-b [&_td]:px-3 [&_td]:py-2 [&_tbody_tr:last-child_td]:border-b-0";
  if (key.includes("grid")) return "grid min-w-0 gap-3 sm:grid-cols-2";
  if (key.includes("source-links") || key.includes("tags") || key.includes("topbar-meta")) return "flex flex-wrap items-center gap-2";
  if (key.includes("source") || key.includes("next") || key.includes("boundary") || key.includes("outcome") || key.includes("observation") || key.includes("note")) return "rounded-lg border bg-muted/40 p-4";
  if (key.includes("study-list") || key.includes("study-ledger") || key.includes("study-content")) return "space-y-3";
  if (key.includes("study-item")) return "rounded-lg border bg-card [&_summary]:flex [&_summary]:cursor-pointer [&_summary]:items-start [&_summary]:gap-3 [&_summary]:p-4 [&_summary]:font-medium [&_summary]:marker:text-primary [&_summary_small]:mt-1 [&_summary_small]:block [&_summary_small]:font-normal [&_summary_small]:text-muted-foreground [&>div]:space-y-3 [&>div]:border-t [&>div]:p-4";
  if (key.includes("study")) return "min-w-0 space-y-3";
  if (key.includes("steps")) return "space-y-4 border-l pl-4 [&_li]:relative [&_li]:grid [&_li]:gap-1 [&_li]:pb-3 [&_li]:sm:grid-cols-[5rem_minmax(0,1fr)] [&_small]:text-xs [&_small]:text-muted-foreground";
  if (key.includes("step-index") || key.includes("number")) return "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary";
  if (key.includes("proof") || key.includes("count") || key.includes("repeat") || key.includes("pass")) return "rounded-full border bg-secondary px-2.5 py-1 text-xs font-medium text-primary";
  if (key.includes("prototype-switcher")) return "fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-sm items-center justify-between rounded-full border bg-card/95 p-2 shadow-lg backdrop-blur";
  if (key.includes("prototype")) return `${showcaseBase} min-h-screen bg-background`;
  if (key.includes("evidence") || key.includes("pair-note") || key.includes("architecture-note")) return "flex gap-3 rounded-lg border border-primary/20 bg-secondary/50 p-4 text-sm leading-6 [&>span]:font-semibold [&_p]:m-0";
  if (["is-enabled", "is-improved", "is-state", "is-review", "is-end"].includes(key)) return "border-primary/40 bg-secondary/70 text-primary";
  if (["is-disabled", "is-withheld", "is-bypassed", "is-unchanged"].includes(key)) return "border-border bg-muted/60 text-muted-foreground";
  if (["is-planner", "is-interrupt", "is-tools"].includes(key)) return "border-primary/30 bg-secondary/50";
  return "min-w-0";
}

export function showcaseClasses(...keys: Array<string | false | undefined>): string {
  return keys.filter((key): key is string => Boolean(key)).map(resolveShowcaseClass).join(" ");
}
