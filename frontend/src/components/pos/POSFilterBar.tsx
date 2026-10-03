import { useMemo, useState } from "react";
import { Search, User, Filter, X, ChevronDown, SlidersHorizontal } from "lucide-react";
import { POSDateRangeFilter } from "./POSDateRangeFilter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/common/utils";

interface FilterOption {
  key: string;
  name: string;
}

interface POSFilterBarProps {
  // Search
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;

  // Floor Filter
  floors?: FilterOption[];
  selectedFloor: string;
  onFloorChange: (floor: string) => void;

  // Cashier Filter
  cashiers?: FilterOption[];
  selectedCashier: string;
  onCashierChange: (cashier: string) => void;

  // Date Range
  startDate: string;
  endDate: string;
  onDateRangeChange: (start: string, end: string) => void;

  // Extra Filters (e.g., Type dropdown)
  extraFilters?: React.ReactNode;

  // Bottom Filters (e.g., Status tabs)
  bottomFilters?: React.ReactNode;

  // My Bills toggle
  showMyBillsOnly?: boolean;
  onMyBillsToggle?: (enabled: boolean) => void;

  hideSearch?: boolean;

  /** Mobile: collapse floor/cashier/type behind a Filters toggle to save vertical space */
  collapseFiltersOnMobile?: boolean;

  /** Extra count for badge on collapsed Filters button (e.g. type filter) */
  extraActiveFilterCount?: number;

  // Layout
  className?: string;
}

export function POSFilterBar({
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search...",
  floors = [],
  selectedFloor,
  onFloorChange,
  cashiers = [],
  selectedCashier,
  onCashierChange,
  startDate,
  endDate,
  onDateRangeChange,
  extraFilters,
  bottomFilters,
  showMyBillsOnly,
  onMyBillsToggle,
  hideSearch = false,
  collapseFiltersOnMobile = false,
  extraActiveFilterCount = 0,
  className,
}: POSFilterBarProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const activeFilterCount = useMemo(() => {
    let n = extraActiveFilterCount;
    if (selectedFloor !== "all") n += 1;
    if (selectedCashier !== "all") n += 1;
    if (showMyBillsOnly) n += 1;
    return n;
  }, [selectedFloor, selectedCashier, showMyBillsOnly, extraActiveFilterCount]);

  const floorTabs = (compact: boolean) => (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 bg-muted/40 p-0.5 rounded-xl border border-border overflow-x-auto scrollbar-none">
      <button
        type="button"
        onClick={() => onFloorChange("all")}
        className={cn(
          "rounded-lg text-[10px] font-bold uppercase transition-all whitespace-nowrap shrink-0",
          compact ? "px-2 py-1" : "px-3 py-1.5",
          selectedFloor === "all"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
      >
        {compact ? "All" : "All Floors"}
      </button>
      {floors.map((f) => (
        <button
          type="button"
          key={f.key}
          onClick={() => onFloorChange(f.key)}
          className={cn(
            "rounded-lg text-[10px] font-bold uppercase transition-all whitespace-nowrap shrink-0",
            compact ? "px-2 py-1" : "px-3 py-1.5",
            selectedFloor === f.key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          {f.name}
        </button>
      ))}
    </div>
  );

  const cashierSelect = (compact: boolean) => (
    <Select value={selectedCashier} onValueChange={onCashierChange}>
      <SelectTrigger
        className={cn(
          "bg-background border-border rounded-xl text-xs font-semibold focus:ring-primary/20",
          compact ? "w-[130px] h-8" : "w-[160px] h-9",
        )}
      >
        <div className="flex items-center gap-1.5">
          <User className={cn("text-primary", compact ? "w-3 h-3" : "w-3.5 h-3.5")} />
          <SelectValue placeholder="All Cashiers" />
        </div>
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border shadow-xl">
        <SelectItem value="all" className="text-xs font-medium">
          All Cashiers
        </SelectItem>
        {cashiers.map((c) => (
          <SelectItem key={c.key} value={c.key} className="text-xs font-medium">
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const myBillsButton = (compact: boolean) =>
    onMyBillsToggle ? (
      <button
        type="button"
        onClick={() => onMyBillsToggle(!showMyBillsOnly)}
        className={cn(
          "flex items-center rounded-xl font-bold transition-all border shrink-0",
          compact ? "gap-1 px-2 py-1.5 text-[10px]" : "gap-2 px-4 py-2 text-xs",
          showMyBillsOnly
            ? "bg-primary/10 border-primary text-primary shadow-sm"
            : "bg-background border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
        )}
      >
        <Filter className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
        <span className="whitespace-nowrap">{compact ? "My Bills" : "Only My Bills"}</span>
      </button>
    ) : null;

  // Desktop: all filters in one flex-wrap row
  const desktopFilters = (
    <div className="hidden sm:flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Floor
        </label>
        {floorTabs(false)}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Cashier
        </label>
        {cashierSelect(false)}
      </div>

      {myBillsButton(false)}

      {extraFilters && <div className="flex items-center gap-2">{extraFilters}</div>}

      {bottomFilters && <div className="flex items-center gap-2">{bottomFilters}</div>}
    </div>
  );

  // Mobile: stacked / collapsible to reduce vertical space
  const mobileFilters = (
    <div className="flex flex-col sm:hidden gap-2">
      {collapseFiltersOnMobile ? (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider shrink-0 transition-all",
                mobileFiltersOpen || activeFilterCount > 0
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-background border-border text-muted-foreground",
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[9px] leading-[1.1rem] text-center">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={cn("w-3.5 h-3.5 transition-transform", mobileFiltersOpen && "rotate-180")}
              />
            </button>
            {bottomFilters && <div className="min-w-0 flex-1">{bottomFilters}</div>}
          </div>

          {mobileFiltersOpen && (
            <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap shrink-0">
                  Floor
                </label>
                {floorTabs(true)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {cashierSelect(true)}
                {myBillsButton(true)}
                {extraFilters && <div className="flex min-w-0 items-center gap-2">{extraFilters}</div>}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap shrink-0">
              Floor
            </label>
            {floorTabs(true)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {cashierSelect(true)}
            {myBillsButton(true)}
            {extraFilters && <div className="flex min-w-0 items-center gap-2">{extraFilters}</div>}
          </div>
          {bottomFilters && <div className="flex min-w-0 items-center gap-2 w-full">{bottomFilters}</div>}
        </>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:gap-3 p-2.5 sm:p-4 bg-card border border-border rounded-2xl shadow-sm",
        className,
      )}
    >
      {!hideSearch ? (
        <>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <div className="relative flex-1 group min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-10 pr-10 py-2 sm:py-2.5 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:font-normal"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <POSDateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onRangeChange={onDateRangeChange}
              className="sm:w-auto shrink-0"
            />
          </div>

          {mobileFilters}
          {desktopFilters}
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1 sm:gap-2 shrink-0 min-w-0">
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                Floor
              </label>
              {floorTabs(true)}
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap hidden sm:inline">
                Cashier
              </label>
              {cashierSelect(true)}
            </div>
            {myBillsButton(true)}
            {extraFilters && <div className="flex items-center gap-2">{extraFilters}</div>}
          </div>
          <div className="shrink-0">
            <POSDateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onRangeChange={onDateRangeChange}
              className="sm:w-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}
