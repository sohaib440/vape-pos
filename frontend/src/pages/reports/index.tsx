import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useMemo, useState, useEffect } from 'react';
import { TrendingUp, DollarSign, Package, Percent, FileBarChart, CreditCard, Wallet, Download, Tag, Clock, CheckCircle2, Search } from 'lucide-react';
import { api, type PaginatedResponse } from '@/lib/api/api';
import { MAX_LIST_LIMIT } from '@/lib/api/paginatedFetch';
import { useQuery } from '@tanstack/react-query';
import { exportReportPdf } from '@/utils/common/exportReportPdf';
import { POSFilterBar } from '@/components/pos/POSFilterBar';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isMenuBundle } from '@/utils/menu/isMenuBundle';

const pieColors = ['hsl(340,70%,21%)', 'hsl(340,60%,30%)', 'hsl(15,45%,81%)', 'hsl(40,70%,55%)', 'hsl(15,25%,13%)'];
const formatPKR = (value: number) => `Rs. ${value.toLocaleString()}`;
type MenuCategory = { id: string; name: string; parentId: string | null; isActive: boolean; children?: MenuCategory[] };

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  // h: 0..360, s/l: 0..100
  const _s = s / 100;
  const _l = l / 100;
  const c = (1 - Math.abs(2 * _l - 1)) * _s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = _l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) [r, g, b] = [c, x, 0];
  else if (h >= 60 && h < 120) [r, g, b] = [x, c, 0];
  else if (h >= 120 && h < 180) [r, g, b] = [0, c, x];
  else if (h >= 180 && h < 240) [r, g, b] = [0, x, c];
  else if (h >= 240 && h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

const readThemeRgb = () => {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim(); // e.g. "340 70% 21%"
  const parseHslVar = (v: string): [number, number, number] | undefined => {
    const parts = v.split(/\s+/).filter(Boolean);
    if (parts.length < 3) return undefined;
    const h = Number(parts[0]);
    const s = Number(parts[1].replace('%', ''));
    const l = Number(parts[2].replace('%', ''));
    if (![h, s, l].every(Number.isFinite)) return undefined;
    return hslToRgb(h, s, l);
  };
  return {
    primaryRgb: parseHslVar(read('--primary')),
    primaryForegroundRgb: parseHslVar(read('--primary-foreground')),
    foregroundRgb: parseHslVar(read('--foreground')),
    mutedForegroundRgb: parseHslVar(read('--muted-foreground')),
    borderRgb: parseHslVar(read('--border')),
    tableStripeRgb: parseHslVar(read('--muted')),
  };
};

const svgToPngDataUrl = async (svgUrl: string, size = 256) => {
  const svgText = await fetch(svgUrl).then((r) => r.text());
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Failed to load svg image'));
      i.src = blobUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
};

export default function Reports() {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedFloor, setSelectedFloor] = useState(() => {
    return localStorage.getItem('reports_selected_floor') || 'all';
  });
  const [selectedCashier, setSelectedCashier] = useState('all');
  const [cashiers, setCashiers] = useState<{ key: string; name: string }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedParentCategory, setSelectedParentCategory] = useState('all');
  const [selectedChildCategory, setSelectedChildCategory] = useState('all');

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

  useEffect(() => {
    localStorage.setItem('reports_selected_floor', selectedFloor);
  }, [selectedFloor]);
  const [showAllScreenItems, setShowAllScreenItems] = useState(false);

  const { data: floorsData } = useQuery({
    queryKey: ['floors-list'],
    queryFn: () =>
      api<PaginatedResponse<{ key: string; name: string }>>(`/floors?page=1&limit=${MAX_LIST_LIMIT}`),
  });
  const floors = floorsData?.items ?? [];

  const reportsQuery = useQuery({
    queryKey: ['reports-dashboard', startDate, endDate, selectedFloor, selectedCashier],
    queryFn: async () => {
      const floorParam = selectedFloor !== 'all' ? `&floorKey=${selectedFloor}` : '';
      const cashierParam = selectedCashier !== 'all' ? `&orderTaker=${selectedCashier}` : '';
      const [w, t, s, inv] = await Promise.all([
        api<{ items: { day: string; revenue: number }[] }>(`/reports/weekly-sales?from=${startDate}&to=${endDate}${floorParam}${cashierParam}`),
        api<{ items: { name: string; sold: number; revenue: number; category?: string; description?: string; bundleItems?: { menuItem: string | { name: string }; quantity: number }[] }[] }>(`/reports/top-items?from=${startDate}&to=${endDate}${floorParam}${cashierParam}`),
        api<{
          revenue: number;
          profit: number;
          totalExpenses: number;
          totalPaidExpenses: number;
          totalUnpaidExpenses: number;
          totalServiceCharges: number;
          totalDiscount: number;
          totalAdvanceReceived: number;
          paymentBreakdown: { cash: number; card: number; easypesa: number; other: number };
          totalMenuOut: number;
        }>(`/dashboard/summary?from=${startDate}&to=${endDate}${floorParam}${cashierParam}`),
        api<{ items: { inventoryItemName: string; category: string; unit: string; usedQuantity: number }[] }>(`/reports/inventory-usage?from=${startDate}&to=${endDate}${floorParam}${cashierParam}`),
      ]);
      return { weeklySalesData: w.items, topSellingItems: t.items, summary: s, inventoryUsage: inv.items };
    },
  });
  const weeklySalesData = reportsQuery.data?.weeklySalesData ?? [];
  const topSellingItems = reportsQuery.data?.topSellingItems ?? [];
  const inventoryUsage = reportsQuery.data?.inventoryUsage ?? [];
  const summary = reportsQuery.data?.summary ?? {
    revenue: 0,
    profit: 0,
    totalExpenses: 0,
    totalPaidExpenses: 0,
    totalUnpaidExpenses: 0,
    totalServiceCharges: 0,
    totalDiscount: 0,
    totalAdvanceReceived: 0,
    paymentBreakdown: { cash: 0, card: 0, easypesa: 0, other: 0 },
    totalMenuOut: 0,
  };

  type TopSellingItem = {
    name: string;
    sold: number;
    revenue: number;
    category?: string;
    description?: string;
    isBundle?: boolean;
    bundleItems?: Array<{
      menuItem: string | { name: string };
      quantity: number;
    }>;
  };
  const totalRevenue = summary.revenue;
  const totalSold = useMemo(() => topSellingItems.reduce((s, i) => s + i.sold, 0), [topSellingItems]);

  const [menuSearch, setMenuSearch] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [expandBundles, setExpandBundles] = useState(false);

  const parsedTopSellingItems = useMemo(() => {
    if (!expandBundles) return topSellingItems;

    const expandedMap = new Map<string, { name: string; sold: number; revenue: number; category?: string }>();

    (topSellingItems as TopSellingItem[]).forEach(item => {
      const isBundle = isMenuBundle(item);
      if (isBundle && item.bundleItems?.length) {
        const bundleCount = item.bundleItems.length;
        item.bundleItems.forEach((bi: any) => {
          const subName = (bi.name && bi.name !== String(bi.menuItem)) 
            ? bi.name 
            : (typeof bi.menuItem === 'object' ? bi.menuItem?.name : bi.menuItem);
          if (!subName) return;
          const totalSold = item.sold * (bi.quantity || 1);
          const existing = expandedMap.get(subName) || { name: subName, sold: 0, revenue: 0 };
          existing.sold += totalSold;
          existing.revenue += (item.revenue / bundleCount);
          expandedMap.set(subName, existing);
        });
      } else {
        const existing = expandedMap.get(item.name) || { name: item.name, sold: 0, revenue: 0 };
        existing.sold += item.sold;
        existing.revenue += item.revenue;
        expandedMap.set(item.name, existing);
      }
    });

    return Array.from(expandedMap.values()).sort((a, b) => b.sold - a.sold);
  }, [topSellingItems, expandBundles]);

  const categoryStats = useMemo(() => {
    const stats = new Map<string, { count: number; sold: number; revenue: number }>();
    parsedTopSellingItems.forEach(item => {
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
  }, [parsedTopSellingItems]);

  const filteredTopSellingItems = useMemo(() => {
    let items = parsedTopSellingItems.filter(item =>
      item.name.toLowerCase().includes(menuSearch.toLowerCase())
    );
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
  }, [childCategories, menuSearch, parsedTopSellingItems, selectedCategory, selectedChildCategory, selectedParentCategory]);

  const filteredSalesTotal = useMemo(
    () => filteredTopSellingItems.reduce(
      (acc, item) => ({ sold: acc.sold + item.sold, revenue: acc.revenue + item.revenue }),
      { sold: 0, revenue: 0 }
    ),
    [filteredTopSellingItems]
  );

  const selectedSalesLabel = selectedChildCategory !== 'all'
    ? (childCategories.find(category => category.id === selectedChildCategory)?.name || 'Category')
    : selectedParentCategory !== 'all'
      ? (selectedParent?.name || 'Category')
      : selectedCategory !== 'all'
        ? selectedCategory
        : 'All categories';

  const filteredInventoryUsage = useMemo(() =>
    inventoryUsage.filter(item =>
      item.inventoryItemName.toLowerCase().includes(inventorySearch.toLowerCase())
    ), [inventoryUsage, inventorySearch]
  );

  const handlePrint = () => {
    window.print();
  };

  const handleExportPdf = async () => {
    const theme = readThemeRgb();
    let logoPngDataUrl: string | undefined;
    try {
      logoPngDataUrl = await svgToPngDataUrl('/logo.svg', 256);
    } catch {
      logoPngDataUrl = undefined;
    }
    exportReportPdf({
      range: 'custom',
      customDateFrom: startDate,
      customDateTo: endDate,
      floorName: selectedFloor !== 'all' ? floors.find(f => f.key === selectedFloor)?.name : undefined,
      cashierName: selectedCashier !== 'all' ? selectedCashier : undefined,
      generatedAt: new Date(),
      summary,
      revenueSeries: weeklySalesData,
      topItems: topSellingItems,
      inventoryUsage,
      logoPngDataUrl,
      theme,
      business: {
        name: 'Shangreela Heights',
        addressLine1: 'Ling Mor Kahuta',
        addressLine2: 'Rawalpindi, Pakistan',
        phone: '+92 513314120 / +92 337-5454786',
      },
    });
  };

  const revenueBreakdownLabel =
    `Daily Revenue Breakdown (${new Date(startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} - ${new Date(endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })})`;

  return (
    <>
      {/* Print Styles */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 15mm;
          }
          
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          
          .no-print {
            display: none !important;
          }
          
          .print-only {
            display: block !important;
          }
          
          .pos-card {
            break-inside: avoid;
            page-break-inside: avoid;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 1rem;
            margin-bottom: 1rem;
          }
          
          .grid {
            display: grid;
            gap: 1rem;
          }
          
          .grid-cols-4 {
            grid-template-columns: repeat(4, 1fr);
          }
          
          .grid-cols-2 {
            grid-template-columns: repeat(2, 1fr);
          }
          
          h1, h2, h3, h4 {
            page-break-after: avoid;
          }
          
          table {
            page-break-inside: avoid;
            width: 100%;
            border-collapse: collapse;
          }
          
          table th, table td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          
          table th {
            background-color: #f2f2f2;
          }
          
          .print-header {
            text-align: center;
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid #000;
          }
          
          .print-footer {
            text-align: center;
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid #e5e7eb;
            font-size: 12px;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
          }
          
          .tabular-report {
            width: 100%;
            margin-bottom: 20px;
          }
          
          .tabular-report caption {
            font-weight: bold;
            margin-bottom: 10px;
            font-size: 16px;
          }
        }
        
        @media screen {
          .print-only {
            display: none;
          }
        }
      `}</style>

      <div className="space-y-6">
        {/* Header with Print Button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 no-print mb-4">
          <div>
            <h1 className="font-serif text-2xl font-bold text-foreground">Reporting</h1>
            <p className="text-sm text-muted-foreground">Sales, profit, and payment breakdowns from paid bills.</p>
          </div>
          <button
            onClick={handleExportPdf}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-primary/5 transition"
          >
            <Download className="w-4 h-4" /> Export PDF (A4)
          </button>
        </div>

        <div className="no-print">
          <POSFilterBar
            searchQuery=""
            onSearchChange={() => {}}
            hideSearch={true}
            floors={floors}
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
        </div>

        {/* Print Header */}
        <div className="print-only print-header">
          <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>Restaurant Sales Report</h1>
          <p style={{ fontSize: '14px', color: '#666' }}>
            Period: {new Date(startDate).toLocaleDateString('en-GB')} - {new Date(endDate).toLocaleDateString('en-GB')}
            | Generated: {new Date().toLocaleString()}
          </p>
        </div>

        {/* Summary Cards - Visible on screen */}
        <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-4 no-print">
          {[
            { label: 'Total Revenue', value: formatPKR(totalRevenue), icon: DollarSign },
            { label: 'Profit', value: formatPKR(summary.profit), icon: TrendingUp },
            { label: 'Advance Received', value: formatPKR(summary.totalAdvanceReceived ?? 0), icon: Wallet },
            { label: 'Service Charges', value: formatPKR(summary.totalServiceCharges), icon: Percent },
            { label: 'Discounts given', value: formatPKR(summary.totalDiscount ?? 0), icon: Tag },
            { label: 'Total Expenses', value: formatPKR(summary.totalExpenses), icon: Wallet },
            { label: 'Paid Expenses', value: formatPKR(summary.totalPaidExpenses), icon: CheckCircle2 },
            { label: 'Unpaid Expenses', value: formatPKR(summary.totalUnpaidExpenses), icon: Clock },
            { label: 'Cash Sales', value: formatPKR(summary.paymentBreakdown.cash), icon: DollarSign },
            { label: 'Card Sales', value: formatPKR(summary.paymentBreakdown.card), icon: CreditCard },
            { label: 'EasyPesa Sales', value: formatPKR(summary.paymentBreakdown.easypesa), icon: Wallet },
            { label: 'Menu Out', value: summary.totalMenuOut.toString(), icon: Package },
          ].map(s => (
            <div key={s.label} className="pos-card flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <s.icon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="font-serif text-xl font-bold text-foreground">{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabular Report for Printing */}
        <div className="print-only">
          {/* Summary Table */}
          <table className="tabular-report">
            <caption>Financial Summary</caption>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Amount (PKR)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Total Revenue</td>
                <td>{formatPKR(totalRevenue)}</td>
              </tr>
              <tr>
                <td>Profit</td>
                <td>{formatPKR(summary.profit)}</td>
              </tr>
              <tr>
                <td>Advance Received</td>
                <td>{formatPKR(summary.totalAdvanceReceived ?? 0)}</td>
              </tr>
              <tr>
                <td>Service Charges</td>
                <td>{formatPKR(summary.totalServiceCharges)}</td>
              </tr>
              <tr>
                <td>Discounts given</td>
                <td>{formatPKR(summary.totalDiscount ?? 0)}</td>
              </tr>
              <tr>
                <td>Total Expenses</td>
                <td>{formatPKR(summary.totalExpenses)}</td>
              </tr>
              <tr>
                <td>Paid Expenses</td>
                <td>{formatPKR(summary.totalPaidExpenses)}</td>
              </tr>
              <tr>
                <td>Unpaid Expenses</td>
                <td>{formatPKR(summary.totalUnpaidExpenses)}</td>
              </tr>
              <tr>
                <td>Menu Out</td>
                <td>{summary.totalMenuOut} units</td>
              </tr>
            </tbody>
          </table>

          {/* Payment Breakdown Table */}
          <table className="tabular-report">
            <caption>Payment Breakdown</caption>
            <thead>
              <tr>
                <th>Payment Method</th>
                <th>Amount (PKR)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Cash</td>
                <td>{formatPKR(summary.paymentBreakdown.cash)}</td>
              </tr>
              <tr>
                <td>Card</td>
                <td>{formatPKR(summary.paymentBreakdown.card)}</td>
              </tr>
              <tr>
                <td>EasyPesa</td>
                <td>{formatPKR(summary.paymentBreakdown.easypesa)}</td>
              </tr>
              <tr>
                <td>Other</td>
                <td>{formatPKR(summary.paymentBreakdown.other)}</td>
              </tr>
            </tbody>
          </table>

          {/* Daily Revenue Table */}
          <table className="tabular-report">
            <caption>{revenueBreakdownLabel}</caption>
            <thead>
              <tr>
                <th>Period</th>
                <th>Revenue (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {weeklySalesData.map((day) => (
                <tr key={day.day}>
                  <td>{day.day}</td>
                  <td>{formatPKR(day.revenue)}</td>
                </tr>
              ))}
              {weeklySalesData.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'center' }}>No data available</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Top Selling Items Table */}
          <table className="tabular-report">
            <caption>Menu Items Sales</caption>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Item Name</th>
                <th>Units Sold</th>
                <th>Revenue (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {topSellingItems.map((item, i) => (
                <tr key={item.name}>
                  <td>{i + 1}</td>
                  <td>{item.name}</td>
                  <td>{item.sold}</td>
                  <td>{formatPKR(item.revenue)}</td>
                </tr>
              ))}
              {topSellingItems.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center' }}>No data available</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Inventory Usage Table */}
          <table className="tabular-report">
            <caption>Inventory Usage</caption>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Ingredient</th>
                <th>Category</th>
                <th>Quantity Used</th>
              </tr>
            </thead>
            <tbody>
              {inventoryUsage.map((item, i) => (
                <tr key={item.inventoryItemName}>
                  <td>{i + 1}</td>
                  <td>{item.inventoryItemName}</td>
                  <td>{item.category}</td>
                  <td>{item.usedQuantity.toFixed(2)} {item.unit}</td>
                </tr>
              ))}
              {inventoryUsage.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center' }}>No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Charts - Visible on screen only */}
        <div className="grid lg:grid-cols-2 gap-4 no-print">
          <div className="pos-card">
            <h3 className="font-semibold text-foreground text-sm mb-4">{revenueBreakdownLabel} (PKR)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={weeklySalesData}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [formatPKR(v), 'Revenue']} contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                <Bar dataKey="revenue" fill="hsl(340,70%,21%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="pos-card">
            <h3 className="font-semibold text-foreground text-sm mb-4">Top Items Breakdown</h3>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={topSellingItems} dataKey="sold" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                    {topSellingItems.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Top Selling Items Table - Visible on screen */}
        <div className="pos-card no-print">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-foreground text-sm">Menu Items Sales</h3>
              <button
                onClick={() => setExpandBundles(!expandBundles)}
                className={`text-[10px] uppercase font-black px-2 py-1 rounded-md transition-all ${
                  expandBundles 
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' 
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {expandBundles ? 'View Consolidated' : 'Expand Platters'}
              </button>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full md:w-auto">
              <Select value={selectedParentCategory} onValueChange={(value) => { setSelectedParentCategory(value); setSelectedChildCategory('all'); }}>
                <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs font-semibold"><SelectValue placeholder="All Parent Categories" /></SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-xl max-h-[300px] overflow-y-auto">
                  <SelectItem value="all" className="text-xs font-medium">All parents</SelectItem>
                  {parentCategories.map(category => <SelectItem key={category.id} value={category.id} className="text-xs font-medium">{category.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* 
              <Select value={selectedChildCategory} onValueChange={setSelectedChildCategory}>
                <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs font-semibold"><SelectValue placeholder="All Child Categories" /></SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-xl max-h-[300px] overflow-y-auto">
                  <SelectItem value="all" className="text-xs font-medium">All children</SelectItem>
                  {childCategories.map(category => <SelectItem key={category.id} value={category.id} className="text-xs font-medium">{category.name}</SelectItem>)}
                </SelectContent>
              </Select> 
              */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search menu items..."
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </div>
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
            <div>
              <p className="text-[11px] text-muted-foreground">{selectedSalesLabel} total</p>
              <p className="text-xs text-muted-foreground">{filteredTopSellingItems.length} items · {filteredSalesTotal.sold.toLocaleString()} sold</p>
            </div>
            <p className="font-serif text-xl font-bold text-foreground">{formatPKR(filteredSalesTotal.revenue)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-3 px-2 font-medium">#</th>
                  <th className="py-3 px-2 font-medium">Item</th>
                  <th className="py-3 px-2 font-medium">Category</th>
                  <th className="py-3 px-2 font-medium">Units Sold</th>
                  <th className="py-3 px-2 font-medium">Revenue</th>
                 </tr>
              </thead>
              <tbody>
                {filteredTopSellingItems.map((item, i) => (
                  <tr key={item.name} className="border-b border-border/50 last:border-0">
                    <td className="py-3 px-2">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                     </td>
                    <td className="py-3 px-2 font-medium text-foreground">{item.name}</td>
                    <td className="py-3 px-2 text-muted-foreground text-xs">{(item as any).category || '-'}</td>
                    <td className="py-3 px-2 text-muted-foreground">{item.sold}</td>
                    <td className="py-3 px-2 font-semibold text-foreground">Rs. {item.revenue.toLocaleString()}</td>
                  </tr>
                ))}
                {filteredTopSellingItems.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">No menu items found</td>
                  </tr>
                )}
              </tbody>
              {filteredTopSellingItems.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/40">
                    <td className="py-3 px-2 font-semibold text-foreground" colSpan={3}>{selectedSalesLabel} total</td>
                    <td className="py-3 px-2 font-semibold text-foreground">{filteredSalesTotal.sold.toLocaleString()}</td>
                    <td className="py-3 px-2 font-serif text-lg font-bold text-foreground">{formatPKR(filteredSalesTotal.revenue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Inventory Usage Table - Visible on screen */}
        <div className="pos-card no-print">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <h3 className="font-semibold text-foreground text-sm">Inventory Usage</h3>
            <div className="relative w-full md:w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search inventory..."
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-3 px-2 font-medium">#</th>
                  <th className="py-3 px-2 font-medium">Ingredient</th>
                  <th className="py-3 px-2 font-medium">Category</th>
                  <th className="py-3 px-2 font-medium">Quantity Used</th>
                 </tr>
              </thead>
              <tbody>
                {filteredInventoryUsage.map((item, i) => (
                  <tr key={item.inventoryItemName} className="border-b border-border/50 last:border-0">
                    <td className="py-3 px-2">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                     </td>
                    <td className="py-3 px-2 font-medium text-foreground">{item.inventoryItemName}</td>
                    <td className="py-3 px-2 text-muted-foreground">{item.category}</td>
                    <td className="py-3 px-2 font-semibold text-foreground">{item.usedQuantity.toFixed(2)} {item.unit}</td>
                  </tr>
                ))}
                {filteredInventoryUsage.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">No inventory items found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment Breakdown - Visible on screen */}
        <div className="pos-card no-print">
          <h3 className="font-semibold text-foreground text-sm mb-4">Payment Breakdown</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { label: 'Cash', amount: summary.paymentBreakdown.cash },
              { label: 'Card', amount: summary.paymentBreakdown.card },
              { label: 'EasyPesa', amount: summary.paymentBreakdown.easypesa },
              { label: 'Other', amount: summary.paymentBreakdown.other },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-border p-4">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{formatPKR(item.amount)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Links Section - Hidden in Print */}
        <div className="pos-card no-print">
          <h3 className="font-semibold text-foreground text-sm mb-4">View Detailed Reports</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <Link to="/pos/expenses" className="px-4 py-3 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/15 transition-colors flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Expenses
            </Link>
            <Link to="/pos/sales-analytics" className="px-4 py-3 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/15 transition-colors flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Sales Analytics
            </Link>
          </div>
        </div>

        {/* Print Footer */}
        <div className="print-only print-footer">
          <p>This is a computer-generated report. No signature required.</p>
          <p>Page 1 of 1</p>
        </div>
      </div>
    </>
  );
}

