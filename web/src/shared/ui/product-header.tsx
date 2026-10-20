import type { ReactNode } from "react";
import { ScanLine } from "lucide-react";

const destinations = [
  { href: "/", label: "工作台", id: "workbench" },
  { href: "/review", label: "盲评", id: "review" },
  { href: "/adjudicate", label: "裁决", id: "adjudicate" },
  { href: "/showcase", label: "运行示例", id: "showcase" },
] as const;

export type ProductPage = (typeof destinations)[number]["id"];

export function ProductHeader({ page, rightContent }: { page: ProductPage; rightContent?: ReactNode }) {
  return <>
    <a href="#main-content" className="sr-only z-50 rounded-md bg-background p-3 text-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:ring-2 focus:ring-ring">跳到主要内容</a>
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-14 max-w-[1800px] items-center gap-3 px-4 sm:px-6">
        <a className="inline-flex min-h-11 shrink-0 items-center gap-2.5 font-semibold tracking-tight text-foreground no-underline" href="/" aria-label="TactiScout 球探工作室首页">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true"><ScanLine className="size-[18px]" /></span>
          <span className="text-base">TactiScout<span className="ml-2 hidden border-s border-border ps-2 text-xs font-normal text-muted-foreground sm:inline">球探工作室</span></span>
        </a>
        <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-1 lg:flex" aria-label="主导航">
          {destinations.map((destination) => <a
            key={destination.id}
            href={destination.href}
            aria-current={page === destination.id ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${page === destination.id ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >{destination.label}</a>)}
        </nav>
        {rightContent && <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">{rightContent}</div>}
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-border/50 px-3 py-1 lg:hidden" aria-label="主导航">
        {destinations.map((destination) => <a
          key={destination.id}
          href={destination.href}
          aria-current={page === destination.id ? "page" : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${page === destination.id ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        >{destination.label}</a>)}
      </nav>
    </header>
  </>;
}
