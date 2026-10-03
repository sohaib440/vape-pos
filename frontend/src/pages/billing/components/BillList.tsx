import React from 'react';
import { Printer } from 'lucide-react';
import type { Order, TableInfo } from '@/data/pos/mockData';

interface BillListProps {
  billsByDay: { dayKey: string; dayLabel: string; orders: (Order & { dbId?: string })[] }[];
  activeFilters: {
    status: string;
    floor: string;
    cashier: string;
    startDate: string;
    endDate: string;
    type: string;
  };
  selectedOrderId?: string;
  onSelectOrder: (order: Order & { dbId?: string }) => void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  tableMap: Map<number, TableInfo>;
  grandTotalForBillCard: (o: Order & { dbId?: string }) => number;
  getStatusBadgeClass: (o: Order & { printed?: boolean }) => string;
  getBillStatusLabel: (o: Order & { printed?: boolean }) => string;
  formatOrderDateTime: (date: string) => string;
}

export const BillList: React.FC<BillListProps> = ({
  billsByDay,
  activeFilters,
  selectedOrderId,
  onSelectOrder,
  hasMore,
  loading,
  onLoadMore,
  tableMap,
  grandTotalForBillCard,
  getStatusBadgeClass,
  getBillStatusLabel,
  formatOrderDateTime,
}) => {
  return (
    <div className="pos-card flex h-full min-h-0 flex-col overflow-hidden p-3 sm:p-3.5 shadow-sm">
      <h3 className="mb-2.5 sm:mb-3 shrink-0 px-1 font-semibold text-sm text-foreground">Bills by day</h3>

      <div className="min-h-0 flex-1 space-y-3 sm:space-y-4 overflow-y-auto pr-1 scrollbar-thin">
        {loading && billsByDay.length === 0 && (
          <div className="space-y-2.5 sm:space-y-3 mt-2 px-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-24 sm:h-28 bg-card border border-border/50 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {billsByDay.map(group => (
          <div key={group.dayKey} className="space-y-1.5 sm:space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 border-b border-border/60 pb-1">
              {group.dayLabel}
            </p>
            {group.orders.map(o => (
              <button key={o.id} onClick={() => onSelectOrder(o)}
                className={`w-full text-left p-2.5 sm:p-3.5 rounded-xl border transition-all ${selectedOrderId === o.id
                    ? 'bg-primary/10 border-primary/30 shadow-sm ring-1 ring-primary/15'
                    : 'bg-muted/30 border-border hover:bg-muted/60 hover:border-primary/30'
                  }`}
              >
                <div className="flex justify-between gap-3 sm:gap-4">
                  <span className="font-medium text-xs sm:text-sm text-foreground">{o.id}</span>
                  <div className="text-right">
                    <p className="text-[10px] sm:text-xs text-foreground font-bold uppercase tracking-[0.2em]">Bill</p>
                    <p className="text-sm sm:text-base font-bold text-foreground">Rs. {grandTotalForBillCard(o).toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 sm:mt-1">{formatOrderDateTime(o.createdAt)}</p>
                <div className="mt-1 sm:mt-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <span className="text-[10px] sm:text-xs text-muted-foreground capitalize">{o.type}</span>
                    {o.table && (
                      <>
                        <span className="bg-primary/20 text-primary px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold">
                          {tableMap.get(o.table)?.name || `Table ${o.table}`}
                        </span>
                        {tableMap.get(o.table)?.floorId && (
                          <span className="bg-secondary/20 text-secondary px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold">
                            {tableMap.get(o.table)?.floorId}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <span className={`text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full border ${getStatusBadgeClass(o)}`}>
                    {getBillStatusLabel(o)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ))}
        {hasMore && (
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="w-full py-2.5 sm:py-3 mt-2 rounded-xl border border-dashed border-border text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition-all disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More Bills'}
          </button>
        )}
        {billsByDay.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-8 sm:py-12 text-center px-4 sm:px-6">
            <Printer className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground/20 mb-3 sm:mb-4" />
            <h3 className="text-sm sm:text-base font-bold text-foreground mb-2">No Bills found for applied filters</h3>
            <p className="text-[11px] sm:text-[13px] text-muted-foreground leading-relaxed max-w-[320px]">
              Date Range: <span className="font-bold text-foreground">{activeFilters.startDate}</span> to <span className="font-bold text-foreground">{activeFilters.endDate}</span>.
              <br />Status: <span className="font-bold text-foreground capitalize">{activeFilters.status}</span>
              <br />Type: <span className="font-bold text-foreground capitalize">{activeFilters.type}</span>
              <br />Floor: <span className="font-bold text-foreground capitalize">{activeFilters.floor}</span>
              <br />Cashier: <span className="font-bold text-foreground capitalize">{activeFilters.cashier}</span>
              <br /><br />
              Please adjust your date filter or the criteria above to see more bills.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

