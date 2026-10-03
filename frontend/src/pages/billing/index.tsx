import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Order, TableInfo } from '@/data/pos/mockData';
import { useAuth } from '@/contexts/auth/AuthContext';
import { api, type PaginatedResponse } from '@/lib/api/api';
import { MAX_LIST_LIMIT } from '@/lib/api/paginatedFetch';
import { formatOrderDateTime, groupOrdersByCalendarDay } from '@/utils/common/formatOrderDateTime';
import { usePosRealtimeScopes } from '@/hooks/pos/use-pos-realtime';
import { useSubmitLock } from '@/hooks/pos/use-submit-lock';
import { POSFilterBar } from '@/components/pos/POSFilterBar';
import { billBreakdownForOrder, computePakistanTaxTotals } from '@/utils/pos/pakistanTax';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Utensils, ShoppingBag, Truck, ArrowLeft } from 'lucide-react';
import { useDebounce } from '@/hooks/common/use-debounce';
import { cn } from '@/lib/common/utils';

// New sub-components
import { BillList } from './components/BillList';
import { BillPaymentPanel } from './components/BillPaymentPanel';
import {
  DUMMY_BILL_CASHIERS,
  DUMMY_BILL_FLOORS,
  DUMMY_BILL_TABLES,
  filterDummyBills,
  getDummyBills,
} from './dummyBills';

export default function Billing() {
  const { isLocked, runLocked } = useSubmitLock();
  const { hasAction, user: currentUser, permissions } = useAuth();
  const queryClient = useQueryClient();

  const discountLimit = currentUser
    ? (currentUser.role === 'superadmin' ? 100 : (permissions[currentUser.role]?.discountLimit ?? 0))
    : 0;

  // Core State
  const [orders, setOrders] = useState<(Order & { dbId?: string; printed?: boolean })[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<(Order & { dbId?: string; printed?: boolean }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [usingDummyBills, setUsingDummyBills] = useState(false);
  const [taxRates, setTaxRates] = useState({ gstRate: 0.16, serviceChargeRate: 0.05, takeawayChargeRate: 0.05, minimumOrderAmount: 0 });
  const [printedOrderIds, setPrintedOrderIds] = useState<Set<string>>(new Set());

  // Filter State
  const [billingStatusFilter, setBillingStatusFilter] = useState<'all' | 'paid' | 'pending' | 'ready'>('all');
  const [selectedFloor, setSelectedFloor] = useState<string>('all');
  const [selectedCashier, setSelectedCashier] = useState<string>('all');
  const [showMyBillsOnly, setShowMyBillsOnly] = useState<boolean>(false);
  const [tableSearchQuery, setTableSearchQuery] = useState<string>('');
  const debouncedTableSearch = useDebounce(tableSearchQuery, 500); // Debounce search input

  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>(today);
  const [selectedOrderType, setSelectedOrderType] = useState<string>('all');

  const [cashiers, setCashiers] = useState<{ key: string; name: string }[]>([]);
  const [floors, setFloors] = useState<{ key: string; name: string }[]>([]);

  // Local Storage persistence
  useEffect(() => {
    const saved = localStorage.getItem('printed_order_ids');
    if (saved) {
      try {
        const ids = JSON.parse(saved);
        if (Array.isArray(ids)) setPrintedOrderIds(new Set(ids));
      } catch { }
    }
    const savedFilter = localStorage.getItem('billing_status_filter');
    if (savedFilter && ['all', 'paid', 'pending', 'ready'].includes(savedFilter)) {
      setBillingStatusFilter(savedFilter as any);
    }
    const savedFloor = localStorage.getItem('billing_selected_floor');
    if (savedFloor) setSelectedFloor(savedFloor);
    const savedType = localStorage.getItem('billing_selected_type');
    if (savedType) setSelectedOrderType(savedType);
    const savedCashier = localStorage.getItem('billing_selected_cashier');
    if (savedCashier) setSelectedCashier(savedCashier);
    if (localStorage.getItem('billing_my_bills_only') === 'true') setShowMyBillsOnly(true);
  }, []);

  useEffect(() => { localStorage.setItem('billing_status_filter', billingStatusFilter); }, [billingStatusFilter]);
  useEffect(() => { localStorage.setItem('billing_selected_floor', selectedFloor); }, [selectedFloor]);
  useEffect(() => { localStorage.setItem('billing_selected_type', selectedOrderType); }, [selectedOrderType]);
  useEffect(() => { localStorage.setItem('billing_selected_cashier', selectedCashier); }, [selectedCashier]);
  useEffect(() => { localStorage.setItem('billing_my_bills_only', String(showMyBillsOnly)); }, [showMyBillsOnly]);
  useEffect(() => { localStorage.setItem('printed_order_ids', JSON.stringify(Array.from(printedOrderIds))); }, [printedOrderIds]);

  const markOrderAsPrinted = (orderId: string) => setPrintedOrderIds(prev => new Set([...prev, orderId]));
  const isOrderPrinted = (orderId: string) => printedOrderIds.has(orderId);

  const getBillStatusLabel = (order?: Order & { printed?: boolean }) => {
    if (!order) return 'Pending';
    if (order.status === 'completed') return 'Paid';
    const isReady = ['ready', 'served', 'taken away'].includes(order.status || '') || order.printed || isOrderPrinted(order.id);
    if (isReady) return 'Ready';
    return 'Pending';
  };

  const getStatusBadgeClass = (order?: Order & { printed?: boolean }) => {
    if (!order) return 'bg-warning/15 text-warning border-warning/30';
    if (order.status === 'completed') return 'bg-success/15 text-success border-success/30';
    const isReady = ['ready', 'served', 'taken away'].includes(order.status || '') || order.printed || isOrderPrinted(order.id);
    if (isReady) return 'bg-primary/15 text-primary border-primary/30';
    return 'bg-warning/15 text-warning border-warning/30';
  };

  const sortBills = (list: (Order & { dbId?: string; printed?: boolean })[]) =>
    [...list].sort((a, b) => {
      const isReady = (o: Order & { printed?: boolean }) =>
        ['ready', 'served', 'taken away'].includes(o.status || '') || o.printed || isOrderPrinted(o.id);
      const getPrio = (o: Order & { printed?: boolean }) =>
        o.status === 'completed' ? 3 : isReady(o) ? 1 : 2;
      const pA = getPrio(a);
      const pB = getPrio(b);
      if (pA !== pB) return pA - pB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const applyDummyBills = () => {
    const dummyTableMap = new Map<number, TableInfo>();
    DUMMY_BILL_TABLES.forEach((t) => dummyTableMap.set(t.id, t));
    tables.forEach((t) => dummyTableMap.set(t.id, t));

    const filtered = filterDummyBills(getDummyBills(currentUser?.name), {
      startDate,
      endDate,
      selectedFloor,
      selectedOrderType,
      selectedCashier,
      showMyBillsOnly,
      currentUserName: currentUser?.name,
      search: debouncedTableSearch,
      tableMap: dummyTableMap,
    }).map((o) => ({ ...o, printed: o.printed || isOrderPrinted(o.id) }));

    setUsingDummyBills(true);
    setHasMore(false);
    setOrders(sortBills(filtered));
    setSelectedOrder((prev) => {
      if (!prev) return null;
      return filtered.find((a) => a.id === prev.id) || null;
    });
  };

  const loadOrders = (pageNum = 1, append = false) => {
    setLoading(true);
    const params = new URLSearchParams({
      status: 'all',
      limit: '100',
      page: String(pageNum),
      today: 'false',
      from: startDate,
      to: endDate,
      floorKey: selectedFloor,
      search: debouncedTableSearch,
    });

    if (selectedOrderType !== 'all') {
      params.append('type', selectedOrderType);
    }

    if (showMyBillsOnly && currentUser?.name) {
      params.append('orderTaker', currentUser.name);
    } else if (selectedCashier !== 'all') {
      params.append('orderTaker', selectedCashier);
    }

    return api<PaginatedResponse<Order & { dbId: string }>>(`/orders?${params.toString()}`)
      .then((r) => {
        const filteredResult = r.items.filter((o) => o.status !== 'cancelled');
        const ordersWithPrinted = filteredResult.map((o) => ({ ...o, printed: isOrderPrinted(o.id) }));

        // When API has nothing for this filter set, show demo bills so mobile UI can be tested
        if (!append && ordersWithPrinted.length === 0) {
          applyDummyBills();
          return;
        }

        setUsingDummyBills(false);
        setOrders((prev) => sortBills(append ? [...prev, ...ordersWithPrinted] : ordersWithPrinted));
        setHasMore(r.pagination.hasNext);
        setPage(pageNum);

        setOrders((current) => {
          setSelectedOrder((prev) => {
            if (prev) {
              const match = current.find((a) => a.id === prev.id);
              if (match) return match;
            }
            return null;
          });
          return current;
        });
      })
      .catch(() => {
        if (!append) applyDummyBills();
      })
      .finally(() => setLoading(false));
  };

  const loadTables = () =>
    api<PaginatedResponse<any>>(`/tables?page=1&limit=${MAX_LIST_LIMIT}`).then((r) => {
      const floorsList = Array.from(new Set(r.items.map((t: any) => t.floorKey).filter(Boolean)));
      setFloors(
        floorsList.length
          ? floorsList.map((k: any) => ({ key: k, name: k }))
          : DUMMY_BILL_FLOORS,
      );
      setTables(
        r.items.length
          ? r.items.map((t: any) => ({
            id: t.number,
            mongoId: t.id,
            number: t.number,
            name: t.name,
            seats: t.seats,
            floorId: t.floorKey,
            status: t.status,
            currentOrder: t.currentOrder,
          }))
          : DUMMY_BILL_TABLES,
      );
    }).catch(() => {
      setFloors(DUMMY_BILL_FLOORS);
      setTables(DUMMY_BILL_TABLES);
    });

  const loadUsers = () => {
    api<PaginatedResponse<any>>('/users?limit=100').then((r) => {
      const relevant = r.items.filter((u: any) => ['cashier', 'admin'].includes(u.role));
      setCashiers(
        relevant.length
          ? relevant.map((u: any) => ({ key: u.name, name: u.name }))
          : DUMMY_BILL_CASHIERS,
      );
    }).catch(() => setCashiers(DUMMY_BILL_CASHIERS));
  };

  const loadTaxRates = useCallback(() => {
    api<{ salesTaxRate: number; serviceChargeRate: number; takeawayChargeRate: number; minimumOrderAmount: number }>('/settings/tax').then(r => {
      const gst = Number(r.salesTaxRate ?? 16) / 100;
      const sc = Number(r.serviceChargeRate ?? 5) / 100;
      const tc = Number(r.takeawayChargeRate ?? 5) / 100;
      setTaxRates({
        gstRate: Number.isFinite(gst) ? gst : 0.16,
        serviceChargeRate: Number.isFinite(sc) ? sc : 0.05,
        takeawayChargeRate: Number.isFinite(tc) ? tc : 0.05,
        minimumOrderAmount: Number(r.minimumOrderAmount ?? 0),
      });
    }).catch(() => { });
  }, []);

  // Use debounced search value as dependency
  useEffect(() => {
    loadOrders();
  }, [startDate, endDate, selectedFloor, debouncedTableSearch, selectedCashier, showMyBillsOnly, selectedOrderType]);
  //    ^^^^^^^^^^^^^^^^^^^^ This now updates only when debounced value changes

  useEffect(() => { loadTables(); loadUsers(); loadTaxRates(); }, []);

  usePosRealtimeScopes(['orders', 'tables', 'settings'], () => {
    loadOrders();
    loadTables();
    loadTaxRates();
  });

  const tableMap = useMemo(() => {
    const map = new Map<number, TableInfo>();
    const source = tables.length ? tables : DUMMY_BILL_TABLES;
    source.forEach((t) => {
      map.set(t.id, t);
    });
    // Ensure dummy table names resolve when demo bills are active alongside real tables
    if (usingDummyBills) {
      DUMMY_BILL_TABLES.forEach((t) => {
        if (!map.has(t.id)) map.set(t.id, t);
      });
    }
    return map;
  }, [tables, usingDummyBills]);

  const displayFloors = useMemo(() => {
    if (!usingDummyBills) return floors.length ? floors : DUMMY_BILL_FLOORS;
    const merged = [...floors];
    DUMMY_BILL_FLOORS.forEach((f) => {
      if (!merged.some((x) => x.key === f.key)) merged.push(f);
    });
    return merged.length ? merged : DUMMY_BILL_FLOORS;
  }, [floors, usingDummyBills]);

  const displayCashiers = useMemo(() => {
    if (!usingDummyBills) return cashiers.length ? cashiers : DUMMY_BILL_CASHIERS;
    const merged = [...cashiers];
    DUMMY_BILL_CASHIERS.forEach((c) => {
      if (!merged.some((x) => x.key === c.key)) merged.push(c);
    });
    return merged.length ? merged : DUMMY_BILL_CASHIERS;
  }, [cashiers, usingDummyBills]);

  const filteredOrders = useMemo(() => {
    if (billingStatusFilter === 'all') return orders;
    return orders.filter(o => {
      const isReady = ['ready', 'served', 'taken away'].includes(o.status || '') || o.printed || isOrderPrinted(o.id);
      const status = o.status === 'completed' ? 'paid' : (isReady ? 'ready' : 'pending');
      return status === billingStatusFilter;
    });
  }, [orders, billingStatusFilter, printedOrderIds]);

  const billsByDay = useMemo(() => groupOrdersByCalendarDay(filteredOrders, true), [filteredOrders]);

  const grandTotalForBillCard = (o: Order & { dbId?: string }) => {
    if (o.status === 'completed' && Number.isFinite(Number(o.total))) return Number(o.total);
    return billBreakdownForOrder(o, taxRates).grandTotal;
  };

  const stats = useMemo(() => {
    return {
      all: orders.length,
      pending: orders.filter(o => {
        const isReady = ['ready', 'served', 'taken away'].includes(o.status || '') || o.printed || isOrderPrinted(o.id);
        return o.status !== 'completed' && !isReady;
      }).length,
      ready: orders.filter(o => {
        const isReady = ['ready', 'served', 'taken away'].includes(o.status || '') || o.printed || isOrderPrinted(o.id);
        return o.status !== 'completed' && isReady;
      }).length,
      paid: orders.filter(o => o.status === 'completed').length,
    };
  }, [orders, printedOrderIds]);

  const viewingBillOnNarrow = !!selectedOrder;

  return (
    <div className="flex h-[calc(100dvh-5rem)] sm:h-[calc(100dvh-7rem)] min-h-0 flex-col gap-3 sm:gap-4">
      <div className={cn(viewingBillOnNarrow && 'hidden xl:block')}>
        <POSFilterBar
          searchQuery={tableSearchQuery}
          onSearchChange={setTableSearchQuery}
          searchPlaceholder="Search table number or ID..."
          floors={displayFloors}
          selectedFloor={selectedFloor}
          onFloorChange={setSelectedFloor}
          cashiers={displayCashiers}
          selectedCashier={selectedCashier}
          onCashierChange={setSelectedCashier}
          startDate={startDate}
          endDate={endDate}
          onDateRangeChange={(start, end) => { setStartDate(start); setEndDate(end); }}
          showMyBillsOnly={showMyBillsOnly}
          onMyBillsToggle={setShowMyBillsOnly}
          collapseFiltersOnMobile
          extraActiveFilterCount={selectedOrderType !== 'all' ? 1 : 0}
          extraFilters={
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap">Type</label>
              <Select value={selectedOrderType} onValueChange={setSelectedOrderType}>
                <SelectTrigger className="w-[110px] sm:w-[130px] h-8 bg-background border-border rounded-xl text-xs font-semibold focus:ring-primary/20">
                  <div className="flex items-center gap-2">
                    {selectedOrderType === 'dine-in' && <Utensils className="w-3.5 h-3.5 text-primary" />}
                    {selectedOrderType === 'takeaway' && <ShoppingBag className="w-3.5 h-3.5 text-primary" />}
                    {selectedOrderType === 'delivery' && <Truck className="w-3.5 h-3.5 text-primary" />}
                    <SelectValue placeholder="All types" />
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-xl">
                  <SelectItem value="all" className="text-xs font-medium">All Types</SelectItem>
                  <SelectItem value="dine-in" className="text-xs font-medium">Dine-in</SelectItem>
                  <SelectItem value="takeaway" className="text-xs font-medium">Takeaway</SelectItem>
                  <SelectItem value="delivery" className="text-xs font-medium">Delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
          bottomFilters={
            <div className="flex w-full min-w-0 items-center gap-0.5 sm:gap-1 bg-muted/40 p-0.5 sm:p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
              {(['all', 'pending', 'ready', 'paid'] as const).map(f => (
                <button key={f} onClick={() => setBillingStatusFilter(f)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all whitespace-nowrap shrink-0 ${billingStatusFilter === f ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {f} ({stats[f]})
                </button>
              ))}
            </div>
          }
        />
        {usingDummyBills && (
          <p className="mt-1.5 px-1 text-[10px] font-medium text-muted-foreground">
            Showing demo bills for UI testing — real orders will replace these when available.
          </p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:gap-5 overflow-hidden xl:grid-cols-[480px_minmax(0,1fr)]">
        <div className={cn('min-h-0 flex flex-col', viewingBillOnNarrow && 'hidden xl:flex')}>
          <BillList
            billsByDay={billsByDay}
            activeFilters={{
              status: billingStatusFilter,
              floor: selectedFloor,
              cashier: selectedCashier,
              startDate,
              endDate,
              type: selectedOrderType
            }}
            selectedOrderId={selectedOrder?.id}
            onSelectOrder={setSelectedOrder}
            hasMore={hasMore}
            loading={loading}
            onLoadMore={() => loadOrders(page + 1, true)}
            tableMap={tableMap}
            grandTotalForBillCard={grandTotalForBillCard}
            getStatusBadgeClass={getStatusBadgeClass}
            getBillStatusLabel={getBillStatusLabel}
            formatOrderDateTime={formatOrderDateTime}
          />
        </div>

        <div className={cn('min-h-0 flex flex-col', !viewingBillOnNarrow && 'hidden xl:flex')}>
          {viewingBillOnNarrow && (
            <button
              type="button"
              onClick={() => setSelectedOrder(null)}
              className="xl:hidden mb-2 inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to bills
            </button>
          )}
          <BillPaymentPanel
            order={selectedOrder}
            tableMap={tableMap}
            taxRates={taxRates}
            currentUser={currentUser}
            hasAction={hasAction}
            discountLimit={discountLimit}
            onPaymentComplete={async () => {
              await loadOrders();
              queryClient.invalidateQueries({ queryKey: ['pos-tables', 'dashboard-overview', 'reports-dashboard', 'analytics-dashboard'] });
            }}
            markOrderAsPrinted={markOrderAsPrinted}
            isOrderPrinted={isOrderPrinted}
            runLocked={runLocked}
            isLocked={isLocked}
            getStatusBadgeClass={getStatusBadgeClass}
            getBillStatusLabel={getBillStatusLabel}
            formatOrderDateTime={formatOrderDateTime}
          />
        </div>
      </div>
    </div>
  );
}
