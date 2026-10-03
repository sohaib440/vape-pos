import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/common/utils";

interface POSDateRangeFilterProps {
  startDate: string;
  endDate: string;
  onRangeChange: (start: string, end: string) => void;
  className?: string;
}

export function POSDateRangeFilter({
  startDate,
  endDate,
  onRangeChange,
  className,
}: POSDateRangeFilterProps) {
  const start = startDate ? new Date(startDate) : undefined;
  const end = endDate ? new Date(endDate) : undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date-range"
            variant={"outline"}
            size="sm"
            className={cn(
              "w-full justify-start text-left font-normal bg-card border-border rounded-xl px-4 py-2 h-auto text-xs hover:border-primary/40 hover:bg-primary/5 transition-all",
              !startDate && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
            {startDate ? (
              endDate && startDate !== endDate ? (
                <>
                  {format(start!, "LLL dd, y") + " - " + format(end!, "LLL dd, y")}
                </>
              ) : (
                format(start!, "LLL dd, y")
              )
            ) : (
              <span>Pick a range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 rounded-2xl border-border shadow-xl" align="end">
          <div className="p-4 border-b border-border bg-muted/30">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => onRangeChange(e.target.value, endDate)}
                  className="w-full bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => onRangeChange(startDate, e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  onRangeChange(today, today);
                }}
                className="shrink-0 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 transition-all"
              >
                Today
              </button>
              <button
                onClick={() => {
                  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                  onRangeChange(yesterday, yesterday);
                }}
                className="shrink-0 px-3 py-1 rounded-full bg-muted text-muted-foreground text-[10px] font-bold hover:bg-muted/80 transition-all"
              >
                Yesterday
              </button>
              <button
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 7);
                  onRangeChange(d.toISOString().split('T')[0], new Date().toISOString().split('T')[0]);
                }}
                className="shrink-0 px-3 py-1 rounded-full bg-muted text-muted-foreground text-[10px] font-bold hover:bg-muted/80 transition-all"
              >
                Last 7 Days
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

