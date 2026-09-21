const { Order, MenuItem, InventoryItem, Employee, Expense, Table } = require("../models");
const {
  parseDateRange,
  parseCustomDateRange,
  buildPaidOrdersQuery,
  getReportingWindowStart,
} = require("../utils/reportingQueries");
const { getEffectiveTaxRates } = require("../utils/orderTotals");
const { isMenuBundle, BUNDLE_MENU_QUERY } = require("../utils/isMenuBundle");

const PAID_ORDER_LIST_PROJECTION =
  "total subtotal discount advanceAmount serviceCharge gstAmount gstEnabled type paymentMethod items.quantity items.menuItem.price items.menuItem.name items.menuItem.category items.menuItem.description items.menuItem.bundleItems items.menuItem.isBundle createdAt";

const getTableNames = async (floorKey) => {
  if (!floorKey || floorKey === "all") return null;
  const tables = await Table.find({ floorKey }).select("name").lean();
  return tables.map((t) => t.name).filter(Boolean);
};

const getAuxCreatedAtForReq = (req) => {
  const range = String(req.query.range || "all");
  const from = req.query.from;
  const to = req.query.to;
  const dateFilter = from || to ? parseCustomDateRange(from, to) : parseDateRange(range);
  return dateFilter || { $gte: getReportingWindowStart() };
};

async function loadPaidOrdersLeanForReq(req) {
  const range = String(req.query.range || "all");
  const from = req.query.from;
  const to = req.query.to;
  const floorKey = req.query.floorKey;
  const orderTaker = req.query.orderTaker;
  const tableNames = await getTableNames(floorKey);
  const paidQuery = buildPaidOrdersQuery(range, from, to, tableNames, orderTaker);
  const orders = await Order.find(paidQuery).select(PAID_ORDER_LIST_PROJECTION).lean();
  return { orders, range, from, to, floorKey, tableNames, orderTaker };
}

async function fetchDashboardAuxiliaryCounts(auxCreatedAt, orderTaker = null) {
  const expenseQuery = { paymentDate: auxCreatedAt };
  const cancelledQuery = { status: "cancelled", createdAt: auxCreatedAt };
  const openQuery = { status: { $nin: ["completed", "cancelled"] } };

  if (orderTaker && orderTaker !== "all") {
    cancelledQuery.orderTaker = orderTaker;
    openQuery.orderTaker = orderTaker;
    // Expenses don't typically have an orderTaker, but if they did we could add it here
  }

  return Promise.all([
    MenuItem.countDocuments({}),
    InventoryItem.countDocuments({ $expr: { $lte: ["$quantity", "$minStock"] } }),
    Employee.countDocuments({ status: "active" }),
    Order.countDocuments(cancelledQuery),
    Order.countDocuments(openQuery),
    Expense.aggregate([
      { $match: expenseQuery },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          totalPaid: { $sum: "$paidAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);
}

const normalizeOrderFinancials = (order, rates = { gstRate: 0.16, serviceChargeRate: 0.05 }) => {
  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount || 0);
  const serviceChargeRate = Number.isFinite(Number(rates.serviceChargeRate)) ? Number(rates.serviceChargeRate) : 0.05;
  const gstRate = Number.isFinite(Number(rates.gstRate)) ? Number(rates.gstRate) : 0.16;
  const minimumOrderAmount = Math.max(0, Number(rates.minimumOrderAmount ?? 0));
  const aboveMinimum = Math.max(0, subtotal - discount) >= minimumOrderAmount;
  const applyServiceCharge = String(order.type || "dine-in") === "dine-in";
  const computedServiceCharge = aboveMinimum && applyServiceCharge ? Math.round(Math.max(0, subtotal - discount) * serviceChargeRate) : 0;
  const serviceCharge = order.serviceCharge != null ? Number(order.serviceCharge) : computedServiceCharge;
  const computedGstAmount = !aboveMinimum || order.gstEnabled === false ? 0 : Math.round((Math.max(0, subtotal - discount) + serviceCharge) * gstRate);
  const gstAmount = Number(order.gstAmount ?? computedGstAmount);
  const total = Number(order.total ?? Math.max(0, subtotal - discount) + serviceCharge + gstAmount);
  return { subtotal, discount, serviceCharge, gstAmount, total };
};

const buildTopMenuItems = async (orders) => {
  const menuItems = await MenuItem.find(BUNDLE_MENU_QUERY).select("name bundleItems isBundle category").populate("bundleItems.menuItem", "name").lean();
  const menuMap = new Map(menuItems.map(m => [m.name, m.bundleItems]));

  const map = new Map();
  for (const order of orders) {
    for (const it of order.items || []) {
      const name = it.menuItem?.name || "Unknown";
      const key = name;
      const prev = map.get(key) || { 
        sold: 0, 
        revenue: 0,
        category: it.menuItem?.category || "",
        description: it.menuItem?.description || "",
        bundleItems: it.menuItem?.bundleItems || [],
        isBundle: isMenuBundle(it.menuItem),
      };
      
      // Fallback for old orders or missing bundleItems in snapshot
      const isBundle = isMenuBundle(prev);
      const hasIncompleteBundles = prev.bundleItems && prev.bundleItems.length > 0 && prev.bundleItems.some(bi => !bi.name || bi.name === String(bi.menuItem));
      
      if (isBundle && (!prev.bundleItems || prev.bundleItems.length === 0 || hasIncompleteBundles)) {
        const currentBundle = menuMap.get(name);
        if (currentBundle) {
          prev.bundleItems = currentBundle
            .filter(bi => bi && bi.menuItem)
            .map(bi => ({
              menuItem:
                typeof bi.menuItem === "object"
                  ? (bi.menuItem._id || bi.menuItem.id)
                  : bi.menuItem,

              name:
                typeof bi.menuItem === "object"
                  ? bi.menuItem.name
                  : (bi.name || ""),

              quantity: bi.quantity
            }));
        }
      }

      const quantity = Number(it.quantity || 0);
      prev.sold += quantity;
      prev.revenue += quantity * Number(it.menuItem?.price || 0);
      map.set(key, prev);
    }
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.sold - a.sold);
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const buildRevenueSeries = (range, orders, from, to) => {
  const now = new Date();
  const r = String(range || "week");
  const orderTotal = (o) => Number(o.total || 0);

  if (from || to) {
    const startDate = from ? new Date(from) : new Date(now);
    startDate.setHours(0, 0, 0, 0);
    const endDate = to ? new Date(to) : new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const totals = new Map();
    const labels = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      const key = current.toISOString().slice(0, 10);
      const label = current.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      labels.push({ key, label });
      totals.set(key, 0);
      current.setDate(current.getDate() + 1);
    }

    for (const o of orders) {
      const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
      if (totals.has(key)) totals.set(key, totals.get(key) + orderTotal(o));
    }

    return labels.map((x) => ({ day: x.label, revenue: totals.get(x.key) || 0 }));
  }

  if (r === "today") {
    const labels = [];
    const totals = new Map();
    for (let i = 6; i >= 0; i -= 1) {
      const d = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
      const key = d.toISOString().slice(0, 10);
      labels.push({ key, label: d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" }) });
      totals.set(key, 0);
    }
    for (const o of orders) {
      const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
      if (totals.has(key)) totals.set(key, totals.get(key) + orderTotal(o));
    }
    return labels.map((x) => ({ day: x.label, revenue: totals.get(x.key) || 0 }));
  }

  if (r === "week") {
    const labels = [];
    const totals = new Map();
    for (let i = 6; i >= 0; i -= 1) {
      const d = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
      const key = d.toISOString().slice(0, 10);
      labels.push({ key, label: d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" }) });
      totals.set(key, 0);
    }
    for (const o of orders) {
      const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
      if (totals.has(key)) totals.set(key, totals.get(key) + orderTotal(o));
    }
    return labels.map((x) => ({ day: x.label, revenue: totals.get(x.key) || 0 }));
  }

  if (r === "month") {
    const y = now.getFullYear();
    const m = now.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const totals = new Map();
    for (let d = 1; d <= lastDay; d += 1) {
      const key = new Date(y, m, d).toISOString().slice(0, 10);
      totals.set(key, 0);
    }
    for (const o of orders) {
      const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
      if (totals.has(key)) totals.set(key, totals.get(key) + orderTotal(o));
    }
    return [...totals.entries()].map(([key, revenue]) => {
      const d = new Date(key);
      return { day: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), revenue };
    });
  }

  if (r === "year") {
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const rows = labels.map((month) => ({ day: month, revenue: 0 }));
    for (const o of orders) {
      const d = new Date(o.createdAt);
      if (d.getFullYear() === now.getFullYear()) rows[d.getMonth()].revenue += orderTotal(o);
    }
    return rows;
  }

  return [];
};

function buildSalesDailyItems(orders, rates) {
  const buckets = new Map();
  for (let i = 9; i <= 20; i += 1) buckets.set(i, 0);
  for (const o of orders) {
    const h = new Date(o.createdAt).getHours();
    if (buckets.has(h)) buckets.set(h, buckets.get(h) + normalizeOrderFinancials(o, rates).total);
  }
  return [...buckets.entries()].map(([hour, sales]) => {
    const suffix = hour >= 12 ? "PM" : "AM";
    const h12 = hour > 12 ? hour - 12 : hour;
    return { hour: `${h12}${suffix}`, sales };
  });
}

function buildOrderTypeBreakdownItems(orders) {
  const n = orders.length || 1;
  const counts = { "dine-in": 0, delivery: 0, takeaway: 0 };
  const revenue = { "dine-in": 0, delivery: 0, takeaway: 0 };
  for (const o of orders) {
    const t = o.type && counts[o.type] !== undefined ? o.type : "dine-in";
    counts[t] += 1;
    revenue[t] += Number(o.total || 0);
  }
  return [
    {
      name: "Dine-in",
      value: Math.round((counts["dine-in"] / n) * 100),
      revenue: revenue["dine-in"],
      count: counts["dine-in"],
    },
    {
      name: "Delivery",
      value: Math.round((counts.delivery / n) * 100),
      revenue: revenue.delivery,
      count: counts.delivery,
    },
    {
      name: "Takeaway",
      value: Math.round((counts.takeaway / n) * 100),
      revenue: revenue.takeaway,
      count: counts.takeaway,
    },
  ];
}

function buildSummaryPayload(orders, rates, menuCount, lowStock, staff, cancelledOrders, openOrders, expenseStats) {
  const totalExpenses = expenseStats[0]?.total || 0;
  const totalPaidExpenses = expenseStats[0]?.totalPaid || 0;
  const totalUnpaidExpenses = totalExpenses - totalPaidExpenses;
  const expenseCount = expenseStats[0]?.count || 0;
  const revenue = orders.reduce((sum, o) => sum + normalizeOrderFinancials(o, rates).total, 0);
  const totalServiceCharges = orders.reduce((sum, o) => sum + normalizeOrderFinancials(o, rates).serviceCharge, 0);
  const totalAdvanceReceived = orders.reduce((sum, o) => sum + Number(o.advanceAmount || 0), 0);
  const paymentBreakdown = orders.reduce(
    (acc, o) => {
      const amount = normalizeOrderFinancials(o, rates).total;
      const method = String(o.paymentMethod || "cash").toLowerCase();
      if (method === "card") acc.card += amount;
      else if (method === "easypesa") acc.easypesa += amount;
      else if (method === "cash") acc.cash += amount;
      else acc.other += amount;
      return acc;
    },
    { cash: 0, card: 0, easypesa: 0, other: 0 }
  );
  const totalMenuOut = orders.reduce((sum, o) => sum + (o.items || []).reduce((count, it) => count + Number(it.quantity || 0), 0), 0);
  const totalDiscount = orders.reduce((sum, o) => sum + normalizeOrderFinancials(o, rates).discount, 0);
  const profit = revenue - totalExpenses;

  return {
    revenue,
    profit,
    totalServiceCharges,
    totalDiscount,
    totalAdvanceReceived,
    paymentBreakdown,
    totalOrders: orders.length,
    openOrders,
    cancelledOrders,
    menuCount,
    lowStock,
    staff,
    totalExpenses,
    totalPaidExpenses,
    totalUnpaidExpenses,
    expenseCount,
    totalMenuOut,
  };
}

async function loadRecentOrdersFormatted(req) {
  const floorKey = req.query.floorKey;
  const orderTaker = req.query.orderTaker;
  const tableNames = await getTableNames(floorKey);
  const query = { status: { $ne: "cancelled" } };
  if (tableNames) query.table = { $in: tableNames };
  if (orderTaker && orderTaker !== "all") query.orderTaker = orderTaker;
  
  const items = await Order.find(query)
    .sort({ createdAt: -1 })
    .limit(10)
    .select("code type status total table items createdAt")
    .lean();
  return items.map((o) => ({
    id: o.code,
    type: o.type,
    status: o.status,
    total: o.total,
    table: o.table,
    items: o.items || [],
    createdAt: o.createdAt,
  }));
}

exports.summary = async (req, res) => {
  try {
    const auxCreatedAt = getAuxCreatedAtForReq(req);
    const [{ orders, orderTaker }, rates, [menuCount, lowStock, staff, cancelledOrders, openOrders, expenseStats]] = await Promise.all([
      loadPaidOrdersLeanForReq(req),
      getEffectiveTaxRates(),
      fetchDashboardAuxiliaryCounts(auxCreatedAt, req.query.orderTaker),
    ]);
    res.json(buildSummaryPayload(orders, rates, menuCount, lowStock, staff, cancelledOrders, openOrders, expenseStats));
  } catch (error) {
    console.error("Dashboard summary error:", error);
    res.status(500).json({ message: error.message || "Failed to load dashboard summary" });
  }
};

exports.bundle = async (req, res) => {
  try {
    const auxCreatedAt = getAuxCreatedAtForReq(req);
    const [{ orders, range, from, to, orderTaker }, rates, [menuCount, lowStock, staff, cancelledOrders, openOrders, expenseStats], recentItems] =
      await Promise.all([
        loadPaidOrdersLeanForReq(req),
        getEffectiveTaxRates(),
        fetchDashboardAuxiliaryCounts(auxCreatedAt, req.query.orderTaker),
        loadRecentOrdersFormatted(req),
      ]);

    const summary = buildSummaryPayload(orders, rates, menuCount, lowStock, staff, cancelledOrders, openOrders, expenseStats);
    const salesDailyItems = buildSalesDailyItems(orders, rates);
    const revenueWeeklyItems = buildRevenueSeries(range, orders, from, to);
    const topItems = await buildTopMenuItems(orders);
    const orderTypeBreakdownItems = buildOrderTypeBreakdownItems(orders);

    res.json({
      summary,
      salesDaily: { items: salesDailyItems },
      revenueWeekly: { items: revenueWeeklyItems },
      topItems: { items: topItems },
      recentOrders: { items: recentItems },
      orderTypeBreakdown: { items: orderTypeBreakdownItems },
    });
  } catch (error) {
    console.error("Dashboard bundle error:", error);
    res.status(500).json({ message: error.message || "Failed to load dashboard bundle" });
  }
};

exports.salesDaily = async (req, res) => {
  try {
    const [{ orders }, rates] = await Promise.all([loadPaidOrdersLeanForReq(req), getEffectiveTaxRates()]);
    res.json({ items: buildSalesDailyItems(orders, rates) });
  } catch (error) {
    console.error("salesDaily error:", error);
    res.status(500).json({ message: error.message || "Failed to load sales" });
  }
};

exports.revenueWeekly = async (req, res) => {
  try {
    const { orders, range, from, to } = await loadPaidOrdersLeanForReq(req);
    res.json({ items: buildRevenueSeries(range, orders, from, to) });
  } catch (error) {
    console.error("revenueWeekly error:", error);
    res.status(500).json({ message: error.message || "Failed to load revenue" });
  }
};

exports.topItems = async (req, res) => {
  try {
    const { orders } = await loadPaidOrdersLeanForReq(req);
    res.json({ items: await buildTopMenuItems(orders) });
  } catch (error) {
    console.error("topItems error:", error);
    res.status(500).json({ message: error.message || "Failed to load top items" });
  }
};

exports.recentOrders = async (req, res) => {
  try {
    const items = await loadRecentOrdersFormatted(req);
    res.json({ items });
  } catch (error) {
    console.error("recentOrders error:", error);
    res.status(500).json({ message: error.message || "Failed to load recent orders" });
  }
};
