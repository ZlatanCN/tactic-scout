import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";

const commonTeams = [
  "AC Milan", "Ajax", "Arsenal", "Atalanta", "Atletico Madrid", "Athletic Club", "Barcelona",
  "Bayer Leverkusen", "Bayern Munich", "Benfica", "Borussia Dortmund", "Chelsea", "Celtic",
  "Feyenoord", "Inter Milan", "Juventus", "Liverpool", "Manchester City", "Manchester United",
  "Napoli", "Newcastle United", "Paris Saint-Germain", "Porto", "PSV Eindhoven", "Real Madrid",
  "Real Sociedad", "Roma", "Sevilla", "Sporting CP", "Tottenham Hotspur", "Valencia", "Villarreal",
];

export interface SearchableTeamSelectProps {
  id: string;
  value: string;
  onChange: (team: string) => void;
  required?: boolean;
  disabled?: boolean;
  defaultOpen?: boolean;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function SearchableTeamSelect({ id, value, onChange, required = true, disabled = false, defaultOpen = false }: SearchableTeamSelectProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const teams = useMemo(() => {
    if (value && !commonTeams.some((team) => normalize(team) === normalize(value))) {
      return [value, ...commonTeams];
    }
    return commonTeams;
  }, [value]);
  const normalizedQuery = normalize(query);
  const filteredTeams = teams.filter((team) => !normalizedQuery || normalize(team).includes(normalizedQuery));
  const customTeam = query.trim() && !teams.some((team) => normalize(team) === normalizedQuery)
    ? query.trim()
    : null;
  const options = customTeam && !filteredTeams.some((team) => normalize(team) === normalizedQuery)
    ? [...filteredTeams, customTeam]
    : filteredTeams;

  return <Combobox
    items={options}
    value={value || null}
    inputValue={query}
    open={open}
    disabled={disabled}
    autoHighlight
    onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) setQuery("");
    }}
    onInputValueChange={setQuery}
    onValueChange={(team) => {
      if (typeof team !== "string") return;
      onChange(team);
      setQuery("");
      setOpen(false);
    }}
  >
    <ComboboxTrigger render={<Button
      id={id}
      type="button"
      variant="outline"
      className="h-9 w-full justify-between px-3 text-sm font-normal"
      aria-labelledby={`${id}-label ${id}-value`}
      aria-required={required}
      aria-invalid={required && !value.trim()}
    />}>
      <span id={`${id}-value`} className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>{value || "搜索并选择球队"}</span>
    </ComboboxTrigger>
    <ComboboxContent className="w-(--anchor-width) overscroll-contain">
      <ComboboxInput aria-label="搜索球队" placeholder="输入球队名称搜索" showTrigger={false} />
      <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">没有匹配的球队。</ComboboxEmpty>
      <ComboboxList>
        {(team) => <ComboboxItem key={team} value={team} className="min-h-9">
          {team === customTeam ? <><span>使用“{team}”</span><span className="ml-auto text-xs text-muted-foreground">添加</span></> : team}
        </ComboboxItem>}
      </ComboboxList>
    </ComboboxContent>
  </Combobox>;
}
