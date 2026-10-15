import { lazy, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SearchableTeamSelectProps } from "./SearchableTeamSelect";

const SearchableTeamSelect = lazy(() => import("./SearchableTeamSelect").then((module) => ({ default: module.SearchableTeamSelect })));

export function DeferredTeamSelect({ id, value, onChange, required = true, disabled = false }: SearchableTeamSelectProps) {
  const [openedOnce, setOpenedOnce] = useState(false);
  const [openOnMount, setOpenOnMount] = useState(false);

  function openPicker() {
    setOpenOnMount(true);
    setOpenedOnce(true);
  }

  const triggerLabel = `${id}-label ${id}-value`;
  if (!openedOnce) return <Button
    id={id}
    type="button"
    variant="outline"
    className="h-9 w-full justify-between px-3 text-sm font-normal"
    aria-labelledby={triggerLabel}
    aria-haspopup="listbox"
    aria-expanded={false}
    aria-required={required}
    aria-invalid={required && !value.trim()}
    disabled={disabled}
    onClick={openPicker}
  >
    <span id={`${id}-value`} className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>{value || "搜索并选择球队"}</span>
    <ChevronDown aria-hidden="true" />
  </Button>;

  return <Suspense fallback={<Button type="button" variant="outline" className="h-9 w-full justify-between px-3 text-sm font-normal" aria-labelledby={triggerLabel} disabled>正在打开球队列表…</Button>}>
    <SearchableTeamSelect
      id={id}
      value={value}
      onChange={(team) => {
        onChange(team);
        setOpenedOnce(false);
        setOpenOnMount(false);
      }}
      required={required}
      disabled={disabled}
      defaultOpen={openOnMount}
    />
  </Suspense>;
}
