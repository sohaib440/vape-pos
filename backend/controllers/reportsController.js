const { Order, Delivery, MenuItem, Table, Recipe, InventoryItem } = require("../models");
const { buildPaidOrdersQuery, parseCustomDateRange } = require("../utils/reportingQueries");
const { isMenuBundle, BUNDLE_MENU_QUERY } = require("../utils/isMenuBundle");

const sumOrderTotal = (order) => Number(order.total || 0);

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const getTableNames = async (floorKey) => {
  if (!floorKey || floorKey === "all") return null;
  const tables = await Table.find({ floorKey }).select("name").lean();
  return tables.map((t) => t.name).filter(Boolean);
};

const buildRevenueSeries = (range, orders, from, to) => {
  const now = new Date();
  const r = String(range || "week");

  // Custom date range support
  if (from || to) {
    const startDate = from ? new Date(from) : new Date(now);
    startDate.setHours(0, 0, 0, 0);
    const endDate = to ? new Date(to) : new Date(now);
    endDate.setHours(23, 59, 59, 999);
    
    // Generate date buckets for the range
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
    
    // Aggregate orders
    for (const o of orders) {
      const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
      if (totals.has(key)) totals.set(key, totals.get(key) + sumOrderTotal(o));
    }
    
    return labels.map((x) => ({ day: x.label, revenue: totals.get(x.key) || 0 }));
  }

  if (r === "today") {
    const buckets = new Map();
    for (let i = 9; i <= 20; i += 1) buckets.set(i, 0);
    for (const o of orders) {
      const h = new Date(o.createdAt).getHours();
      if (buckets.has(h)) buckets.set(h, buckets.get(h) + sumOrderTotal(o));
    }
    return [...buckets.entries()].map(([hour, revenue]) => {
      const suffix = hour >= 12 ? "PM" : "AM";
      const h12 = hour > 12 ? hour - 12 : hour;
      return { day: `${h12}${suffix}`, revenue };
    });
  }

  if (r === "week") {
    const labels = [];
    const totals = new Map();
    for (let i = 6; i >= 0; i -= 1) {
      const d = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" });
      labels.push({ key, label });
      totals.set(key, 0);
    }
    for (const o of orders) {
      const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
      if (totals.has(key)) totals.set(key, totals.get(key) + sumOrderTotal(o));
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
      if (totals.has(key)) totals.set(key, totals.get(key) + sumOrderTotal(o));
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
      if (d.getFullYear() === now.getFullYear()) rows[d.getMonth()].revenue += sumOrderTotal(o);
    }
    return rows;
  }

  // fallback
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const rows = labels.map((day) => ({ day, revenue: 0 }));
  for (const o of orders) {
    const idx = (new Date(o.createdAt).getDay() + 6) % 7;
    rows[idx].revenue += sumOrderTotal(o);
  }
  return rows;
};

exports.weeklySales = async (req, res) => {
  const tableNames = await getTableNames(req.query.floorKey);
  const orders = await Order.find(buildPaidOrdersQuery(req.query.range, req.query.from, req.query.to, tableNames, req.query.orderTaker)).lean();
  res.json({ items: buildRevenueSeries(req.query.range, orders, req.query.from, req.query.to) });
};

exports.topItems = async (req, res) => {
  const tableNames = await getTableNames(req.query.floorKey);
  const orders = await Order.find(buildPaidOrdersQuery(req.query.range, req.query.from, req.query.to, tableNames, req.query.orderTaker)).lean();

  const menuItems = await MenuItem.find(BUNDLE_MENU_QUERY).select("name bundleItems isBundle category").populate("bundleItems.menuItem", "name").lean();
  const menuMap = new Map(menuItems.map(m => [m.name, m.bundleItems]));

  const map = new Map();
  for (const o of orders) {
    for (const i of o.items || []) {
      const name = i.menuItem?.name || "Unknown";
      const key = name;
      const prev = map.get(key) || { 
        sold: 0, 
        revenue: 0, 
        description: i.menuItem?.description || "", 
        category: i.menuItem?.category || "",
        bundleItems: i.menuItem?.bundleItems || [],
        isBundle: isMenuBundle(i.menuItem),
      };

      const isBundle = isMenuBundle(prev);
      const hasIncompleteBundles = prev.bundleItems && prev.bundleItems.length > 0 && prev.bundleItems.some(bi => !bi.name || bi.name === String(bi.menuItem));

      if (isBundle && (!prev.bundleItems || prev.bundleItems.length === 0 || hasIncompleteBundles)) {
        const currentBundle = menuMap.get(name);
        if (currentBundle) {
          prev.bundleItems = currentBundle.map(bi => ({
            menuItem: typeof bi.menuItem === 'object' ? (bi.menuItem._id || bi.menuItem.id) : bi.menuItem,
            name: typeof bi.menuItem === 'object' ? bi.menuItem.name : (bi.name || ''),
            quantity: bi.quantity
          }));
        }
      }

      prev.sold += Number(i.quantity || 0);
      prev.revenue += Number(i.quantity || 0) * Number(i.menuItem?.price || 0);
      map.set(key, prev);
    }
  }
  res.json({ items: [...map.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sold - a.sold) });
};

exports.outdoorDelivery = async (_req, res) => {
  const rows = await Delivery.find({}).lean();
  const map = new Map();
  for (const r of rows) {
    const supervisor = r.assignedRider || "Unassigned";
    const prev = map.get(supervisor) || { supervisor, shiftLabel: "Current", cashCollected: 0, cardDigital: 0, deliveriesCompleted: 0, codPending: 0 };
    prev.cashCollected += Number(r.total || 0);
    if (r.status === "served") prev.deliveriesCompleted += 1;
    if (r.status !== "served") prev.codPending += 1;
    map.set(supervisor, prev);
  }
  res.json({ items: [...map.values()] });
};

exports.inventoryUsageReport = async (req, res) => {
  const tableNames = await getTableNames(req.query.floorKey);
  const orders = await Order.find(buildPaidOrdersQuery(req.query.range, req.query.from, req.query.to, tableNames, req.query.orderTaker)).lean();

  // Aggregate sold quantities by MenuItem ID
  const soldItems = new Map();
  for (const o of orders) {
    for (const i of o.items || []) {
      if (!i.menuItem?.id) continue;
      const id = String(i.menuItem.id);
      const qty = Number(i.quantity || 0);
      soldItems.set(id, (soldItems.get(id) || 0) + qty);
    }
  }

  const mongoose = require("mongoose");
  const validIds = Array.from(soldItems.keys()).filter((id) => mongoose.Types.ObjectId.isValid(id));

  // Fetch MenuItems with their recipes and ingredients
  const menuItems = await MenuItem.find({ _id: { $in: validIds } })
    .populate({
      path: "recipe",
      populate: {
        path: "ingredients.inventoryItem",
        model: "InventoryItem",
        select: "name category unit",
      },
    })
    .populate("ingredientOverrides.inventoryItem", "name category unit")
    .lean();

  const usageMap = new Map();

  for (const item of menuItems) {
    const soldQty = soldItems.get(String(item._id)) || 0;
    if (soldQty <= 0) continue;

    const scale = Number(item.scale || 1);

    // If overrides exist, use them; otherwise use recipe ingredients
    let ingredientsToUse = [];
    if (item.ingredientOverrides && item.ingredientOverrides.length > 0) {
      ingredientsToUse = item.ingredientOverrides.map(override => ({
        inventoryItem: override.inventoryItem,
        baseQuantity: override.baseQuantity,
      }));
    } else if (item.recipe && item.recipe.ingredients) {
      ingredientsToUse = item.recipe.ingredients;
    }

    for (const ing of ingredientsToUse) {
      if (!ing.inventoryItem) continue;
      const invItemId = String(ing.inventoryItem._id);
      const usedQty = soldQty * scale * Number(ing.baseQuantity || 0);

      const existing = usageMap.get(invItemId) || {
        inventoryItemName: ing.inventoryItem.name,
        category: ing.inventoryItem.category || "Uncategorized",
        unit: ing.inventoryItem.unit || "unit",
        usedQuantity: 0,
      };

      existing.usedQuantity += usedQty;
      usageMap.set(invItemId, existing);
    }
  }

  // Return sorted array
  const result = Array.from(usageMap.values()).sort((a, b) => b.usedQuantity - a.usedQuantity);
  res.json({ items: result });
};
