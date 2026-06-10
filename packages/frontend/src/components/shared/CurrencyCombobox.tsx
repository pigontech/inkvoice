import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslation } from "@/i18n";
import { CURRENCIES } from "@/lib/constants";

interface CurrencyComboboxProps {
  value: string;
  onChange: (code: string) => void;
}

export function CurrencyCombobox({ value, onChange }: CurrencyComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = CURRENCIES.find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className="w-full justify-between font-normal" />}
      >
        {selected ? `${selected.code} — ${selected.name}` : t("common.select_currency")}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <Command>
          <CommandInput placeholder={t("common.search_currency")} />
          <CommandList>
            <CommandEmpty>{t("common.no_currency_found")}</CommandEmpty>
            <CommandGroup>
              {CURRENCIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.code} ${c.name}`}
                  data-checked={value === c.code}
                  onSelect={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                >
                  <span className="font-mono text-xs w-10">{c.code}</span>
                  <span>{c.name}</span>
                  <span className="ml-auto text-muted-foreground">{c.symbol}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
