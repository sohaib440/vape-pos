import { DollarSign, ShoppingCart, TrendingUp, XCircle, ArrowUpRight, Percent, ClipboardList, Tag, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { useMemo, useState, useEffect } from 'react';
import { api, type PaginatedResponse } from '@/lib/api/api';
import { MAX_LIST_LIMIT } from '@/lib/api/paginatedFetch';
import { useQuery } from '@tanstack/react-query';
import { formatOrderDateTime, groupOrdersByCalendarDay } from '@/utils/common/formatOrderDateTime';
import { POSFilterBar } from '@/components/pos/POSFilterBar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isMenuBundle } from '@/utils/menu/isMenuBundle';

type RecentOrderRow = { id: string; type: string; status: string; items: unknown[]; total: number; createdAt: string };
type TopSellingItem = {
  name: string;
  sold: number;
  revenue: number;
  category?: string;
  isBundle?: boolean;
  bundleItems?: Array<{
    menuItem: string | { name: string };
    quantity: number;
  }>;
};
type MenuCategory = { id: string; name: string; parentId: string | null; isActive: boolean; children?: MenuCategory[] };

const formatPKR = (value: number) => `Rs. ${value.toLocaleString()}`;

export default function POSDashboard() {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedFloor, setSelectedFloor] = useState('all');
  const [selectedCashier, setSelectedCashier] = useState('all');
  const [cashiers, setCashiers] = useState<{ key: string; name: string }[]>([]);
  const [expandBundles, setExpandBundles] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedParentCategory, setSelectedParentCategory] = useState('all');
  const [selectedChildCategory, setSelectedChildCategory] = useState('all');

  const floorsQuery = useQuery({
    queryKey: ['floors-list'],
    queryFn: () =>
      api<PaginatedResponse<{ key: string; name: string }>>(`/floors?page=1&limit=${MAX_LIST_LIMIT}`),
  });
  const floorsData = floorsQuery.data?.items ?? [];

  const usersQuery = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api<PaginatedResponse<{ name: string, role: string }>>('/users?limit=100'),
  });

  const categoriesQuery = useQuery({
    queryKey: ['menu-categories'],
    queryFn: () => api<{ categories: string[]; tree: MenuCategory[] }>('/menu/categories'),
  });
  const categories = categoriesQuery.data?.categories ?? [];
  const categoryTree = categoriesQuery.data?.tree ?? [];
  const parentCategories = categoryTree.filter(category => !category.parentId && category.isActive);
  const selectedParent = parentCategories.find(category => category.id === selectedParentCategory);
  const childCategories = selectedParent?.children?.filter(category => category.isActive) ?? [];

  useEffect(() => {
    if (usersQuery.data) {
      const relevant = usersQuery.data.items.filter(u => ['cashier', 'admin'].includes(u.role));
      setCashiers(relevant.map(u => ({ key: u.name, name: u.name })));
    }
  }, [usersQuery.data]);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard-overview', startDate, endDate, selectedFloor, selectedCashier],
    queryFn: async () => {
      const floorParam = selectedFloor !== 'all' ? `&floorKey=${selectedFloor}` : '';
      const cashierParam = selectedCashier !== 'all' ? `&orderTaker=${selectedCashier}` : '';
      const b = await api<{
        summary: {
          revenue: number;
          profit: number;
          totalServiceCharges: number;
          totalDiscount: number;
          paymentBreakdown: { cash: number; card: number; easypesa: number; other: number };
          totalOrders: number;
          openOrders: number;
          cancelledOrders: number;
          menuCount: number;
          lowStock: number;
          staff: number;
          totalExpenses: number;
          totalPaidExpenses: number;
          totalUnpaidExpenses: number;
          expenseCount: number;
          totalMenuOut: number;
        };
        salesDaily: { items: { hour: string; sales: number }[] };
        revenueWeekly: { items: { day: string; revenue: number }[] };
        topItems: { items: TopSellingItem[] };
        recentOrders: { items: RecentOrderRow[] };
      }>(`/dashboard/bundle?from=${startDate}&to=${endDate}${floorParam}${cashierParam}`);
      return {
        summary: b.summary,
        dailySalesData: b.salesDaily.items,
        weeklySalesData: b.revenueWeekly.items,
        topSellingItems: b.topItems.items,
        sampleOrders: b.recentOrders.items,
      };
    },
  });

  const summary = dashboardQuery.data?.summary ?? {
    revenue: 0,
    profit: 0,
    totalServiceCharges: 0,
    totalDiscount: 0,
    paymentBreakdown: { cash: 0, card: 0, easypesa: 0, other: 0 },
    totalOrders: 0,
    openOrders: 0,
    cancelledOrders: 0,
    menuCount: 0,
    lowStock: 0,
    staff: 0,
    totalExpenses: 0,
    totalPaidExpenses: 0,
    totalUnpaidExpenses: 0,
    expenseCount: 0,
    totalMenuOut: 0,
  };
  const dailySalesData = dashboardQuery.data?.dailySalesData ?? [];
  const weeklySalesData = dashboardQuery.data?.weeklySalesData ?? [];
  const topSellingItems = dashboardQuery.data?.topSellingItems ?? [];
  const sampleOrders = dashboardQuery.data?.sampleOrders ?? [];

  const expandedTopItems = useMemo(() => {
    if (!expandBundles) return topSellingItems;

    const map = new Map<string, { sold: number; revenue: number; category?: string }>();
    topSellingItems.forEach((item) => {
      if (isMenuBundle(item) && item.bundleItems?.length) {
        const bundleCount = item.bundleItems.length;
        item.bundleItems.forEach((bi: any) => {
          const subName = (bi.name && bi.name !== String(bi.menuItem))
            ? bi.name
            : (typeof bi.menuItem === 'object' ? bi.menuItem?.name : bi.menuItem);
          if (!subName) return;
          const subQty = (bi.quantity || 1) * item.sold;
          const existing = map.get(subName) || { sold: 0, revenue: 0 };
          map.set(subName, {
            sold: existing.sold + subQty,
            revenue: existing.revenue + (item.revenue / bundleCount),
            category: item.category,
          });
        });
      } else {
        const existing = map.get(item.name) || { sold: 0, revenue: 0 };
        map.set(item.name, {
          sold: existing.sold + item.sold,
          revenue: existing.revenue + item.revenue,
          category: item.category,
        });
      }
    });

    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.sold - a.sold);
  }, [topSellingItems, expandBundles]);

  const categoryStats = useMemo(() => {
    const stats = new Map<string, { count: number; sold: number; revenue: number }>();
    expandedTopItems.forEach(item => {
      const cat = item.category || 'Other';
      const existing = stats.get(cat) || { count: 0, sold: 0, revenue: 0 };
      stats.set(cat, {
        count: existing.count + 1,
        sold: existing.sold + item.sold,
        revenue: existing.revenue + item.revenue,
      });
    });
    return Array.from(stats.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [expandedTopItems]);

  const filteredTopItems = useMemo(() => {
    let items = expandedTopItems;
    if (selectedChildCategory !== 'all') {
      const child = childCategories.find(category => category.id === selectedChildCategory);
      items = items.filter(item => (item.category || 'Other') === child?.name);
    } else if (selectedParentCategory !== 'all') {
      const childNames = new Set(childCategories.map(category => category.name));
      items = items.filter(item => childNames.has(item.category || 'Other'));
    } else if (selectedCategory !== 'all') {
      items = items.filter(item => (item.category || 'Other') === selectedCategory);
    }
    return items;
  }, [childCategories, expandedTopItems, selectedCategory, selectedChildCategory, selectedParentCategory]);

  const filteredSalesTotal = useMemo(
    () => filteredTopItems.reduce(
      (acc, item) => ({ sold: acc.sold + item.sold, revenue: acc.revenue + item.revenue }),
      { sold: 0, revenue: 0 }
    ),
    [filteredTopItems]
  );

  const selectedSalesLabel = selectedChildCategory !== 'all'
    ? (childCategories.find(category => category.id === selectedChildCategory)?.name || 'Category')
    : selectedParentCategory !== 'all'
      ? (selectedParent?.name || 'Category')
      : selectedCategory !== 'all'
        ? selectedCategory
        : 'All categories';

  const { dineIn, delivery, takeaway } = useMemo(
    () => ({
      dineIn: sampleOrders.filter((o) => o.type === 'dine-in').length,
      delivery: sampleOrders.filter((o) => o.type === 'delivery').length,
      takeaway: sampleOrders.filter((o) => o.type === 'takeaway').length,
    }),
    [sampleOrders]
  );

  const recentOrdersByDay = useMemo(() => {
    const rows: RecentOrderRow[] = sampleOrders.map((o) => ({
      ...o,
      createdAt: o.createdAt || new Date().toISOString(),
    }));
    return groupOrdersByCalendarDay(rows);
  }, [sampleOrders]);

  const rangeLabel = `${new Date(startDate).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })} - ${new Date(endDate).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;
  const stats = [
    { label: `${rangeLabel} revenue`, value: formatPKR(summary.revenue), icon: DollarSign, change: '' },
    { label: 'Profit', value: formatPKR(summary.profit), icon: TrendingUp, change: '' },
    { label: 'Paid Expenses', value: formatPKR(summary.totalPaidExpenses), icon: TrendingUp, change: '' },
    { label: 'Unpaid Expenses', value: formatPKR(summary.totalUnpaidExpenses), icon: Clock, change: '' },
    { label: 'Service Charges', value: formatPKR(summary.totalServiceCharges), icon: Percent, change: '' },
    { label: 'Discounts given', value: formatPKR(summary.totalDiscount), icon: Tag, change: '' },
    { label: 'Paid orders', value: String(summary.totalOrders), icon: ShoppingCart, change: '' },
    { label: 'Open bills', value: String(summary.openOrders), icon: ClipboardList, change: '' },
  ];

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-col gap-4 overflow-hidden lg:h-[calc(100vh-7rem)]">
      <div className="shrink-0">
        <h1 className="font-serif text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Welcome back. Here's your overview.</p>
      </div>

      <POSFilterBar
        searchQuery=""
        onSearchChange={() => { }}
        hideSearch={true}
        floors={floorsData}
        selectedFloor={selectedFloor}
        onFloorChange={setSelectedFloor}
        cashiers={cashiers}
        selectedCashier={selectedCashier}
        onCashierChange={setSelectedCashier}
        startDate={startDate}
        endDate={endDate}
        onDateRangeChange={(start, end) => {
          setStartDate(start);
          setEndDate(end);
        }}
      />

      <div className="flex-1 overflow-y-auto pr-1 space-y-6 scrollbar-thin">
        {/* Stats */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(s => (
            <div key={s.label} className="pos-card flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                <p className="font-serif text-2xl font-bold text-foreground">{s.value}</p>
                <span className="inline-flex items-center text-xs text-success font-medium mt-1">
                  <ArrowUpRight className="w-3 h-3 mr-0.5" />{s.change}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <s.icon className="w-5 h-5 text-primary" />
              </div>
            </div>
          ))}
        </div>

        {/* Order Type Summary */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { label: 'Dine-in', count: dineIn, color: 'text-primary' },
            { label: 'Delivery', count: delivery, color: 'text-warning' },
            { label: 'Takeaway', count: takeaway, color: 'text-success' },
          ].map(t => (
            <div key={t.label} className="pos-card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <ShoppingCart className={`w-5 h-5 ${t.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t.label} Orders</p>
                <p className="font-serif text-xl font-bold text-foreground">{t.count}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="pos-card lg:col-span-2">
            <h3 className="font-semibold text-foreground text-sm mb-4">Payment Breakdown</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { label: 'Cash', amount: summary.paymentBreakdown.cash },
                { label: 'Card', amount: summary.paymentBreakdown.card },
                { label: 'EasyPesa', amount: summary.paymentBreakdown.easypesa },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-border p-4">
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-xl font-semibold text-foreground">{formatPKR(item.amount)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="pos-card">
            <h3 className="font-semibold text-foreground text-sm mb-4">Menu Out</h3>
            <p className="text-3xl font-serif font-bold text-foreground">{summary.totalMenuOut}</p>
            <p className="text-sm text-muted-foreground mt-2">Total menu items served during selected range.</p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="pos-card">
            <h3 className="font-semibold text-foreground text-sm mb-4">{rangeLabel} sales (PKR)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailySalesData}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(340,70%,21%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(340,70%,21%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => [formatPKR(v), 'Sales']} contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                <Area type="monotone" dataKey="sales" stroke="hsl(340,70%,21%)" fill="url(#salesGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="pos-card">
            <h3 className="font-semibold text-foreground text-sm mb-4">{rangeLabel} revenue breakdown (PKR)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklySalesData}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => [formatPKR(v), 'Revenue']} contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                <Bar dataKey="revenue" fill="hsl(340,70%,21%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top selling & Recent orders */}
        <div className="grid items-stretch lg:grid-cols-2 gap-4">
          <div className="pos-card flex min-h-0 flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
              <h3 className="font-semibold text-foreground text-sm">Menu Items Sales</h3>
              <div className="flex items-center gap-2">
                <Select value={selectedParentCategory} onValueChange={(value) => { setSelectedParentCategory(value); setSelectedChildCategory('all'); }}>
                  <SelectTrigger className="w-[150px] h-8 text-xs font-semibold">
                    <SelectValue placeholder="All Parent Categories" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border shadow-xl max-h-[300px] overflow-y-auto">
                    <SelectItem value="all" className="text-xs font-medium">All parents</SelectItem>
                    {parentCategories.map(category => <SelectItem key={category.id} value={category.id} className="text-xs font-medium">{category.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/*  
                <Select value={selectedChildCategory} onValueChange={setSelectedChildCategory}>
                  <SelectTrigger className="w-[150px] h-8 text-xs font-semibold"><SelectValue placeholder="All Child Categories" /></SelectTrigger>
                  <SelectContent className="rounded-xl border-border shadow-xl max-h-[300px] overflow-y-auto">
                    <SelectItem value="all" className="text-xs font-medium">All children</SelectItem>
                    {childCategories.map(category => <SelectItem key={category.id} value={category.id} className="text-xs font-medium">{category.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                */}
                <button
                  onClick={() => setExpandBundles(!expandBundles)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${expandBundles
                      ? 'bg-primary text-white border-primary'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
                    }`}
                >
                  {expandBundles ? 'Bundles Expanded' : 'Expand Bundles'}
                </button>
              </div>
            </div>
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5 shrink-0">
              <div>
                <p className="text-[11px] text-muted-foreground">{selectedSalesLabel} total</p>
                <p className="text-xs text-muted-foreground">{filteredTopItems.length} items · {filteredSalesTotal.sold.toLocaleString()} sold</p>
              </div>
              <p className="font-serif text-xl font-bold text-foreground">{formatPKR(filteredSalesTotal.revenue)}</p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 max-h-[28rem] scrollbar-thin lg:max-h-[32rem]">
              {filteredTopItems.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <div>
                      <span className="text-sm text-foreground">{item.name}</span>
                      {item.category && (
                        <span className="ml-2 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{item.category}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">Rs. {item.revenue.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{item.sold} sold</p>
                  </div>
                </div>
              ))}
              {filteredTopItems.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No items found for this category</p>
              )}
            </div>
          </div>

          <div className="pos-card flex flex-col">
            <div className="mb-2 shrink-0">
              <h3 className="font-semibold text-foreground text-sm">Recent orders</h3>
              <p className="text-[11px] text-muted-foreground">Grouped by day (newest first)</p>
            </div>
            <div className="max-h-[22rem] space-y-4 overflow-y-auto pr-1 scrollbar-thin lg:max-h-[26rem]">
              {recentOrdersByDay.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No recent orders</p>
              ) : (
                recentOrdersByDay.map((group) => (
                  <div key={group.dayKey} className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-1">
                      {group.dayLabel}
                    </p>
                    <div className="space-y-2">
                      {group.orders.map((order) => (
                        <div key={order.id} className="flex items-center justify-between rounded-xl bg-muted/50 p-3">
                          <div className="min-w-0 pr-2">
                            <p className="truncate text-sm font-medium text-foreground">{order.id}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {order.type} • {order.items.length} items
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{formatOrderDateTime(order.createdAt)}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-foreground">Rs. {order.total.toLocaleString()}</p>
                            <span
                              className={`mt-1 inline-block text-xs font-medium rounded-full px-2 py-0.5 ${order.status === 'pending'
                                  ? 'bg-warning/10 text-warning'
                                  : order.status === 'preparing'
                                    ? 'bg-primary/10 text-primary'
                                    : order.status === 'ready'
                                      ? 'bg-success/10 text-success'
                                      : 'bg-muted text-muted-foreground'
                                }`}
                            >
                              {order.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

