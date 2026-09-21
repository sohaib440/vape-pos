const { parsePagination, buildPaginatedResponse } = require("../utils/pagination");
const { getEffectiveTaxRates, calculateGrandTotal } = require("../utils/orderTotals");
const { emitPosChange } = require("../utils/realtime");
const { deductInventoryForOrder } = require("../utils/inventoryDeduction");
const mongoose = require("mongoose");
const { Order, Table, Delivery } = require("../models");
const Fuse = require("fuse.js");

const broadcastOrderDomain = () => emitPosChange(["orders", "tables", "deliveries", "dashboard"]);

const isSuperAdminUser = (req) => req.isSuperAdmin || (req.user && req.user.role === "superadmin");

const canAction = (req, action) => {
  if (isSuperAdminUser(req)) return true;
  const perms = req.currentPermissions;
  return !!(perms && Array.isArray(perms.actionPermissions) && perms.actionPermissions.includes(action));
};

const getDiscountLimit = (req) => {
  if (isSuperAdminUser(req)) return 100;
  const perms = req.currentPermissions;
  return Number(perms && perms.discountLimit) || 0;
};

const canAccessStaffBills = (req) => {
  if (isSuperAdminUser(req)) return true;
  const perms = req.currentPermissions;
  return !!(perms && Array.isArray(perms.pageAccess) && perms.pageAccess.includes("staffbills"));
};

const checkDiscountChangeError = (req, existing, body) => {
  if (body.discount === undefined || body.discount === null || body.discount === "") return null;
  const incoming = Math.max(0, Number(body.discount) || 0);
  const current = Math.max(0, Number(existing.discount) || 0);
  if (incoming <= current) return null;
  if (!canAction(req, "apply_discount")) {
    return { statusCode: 403, message: "You do not have permission to apply discounts." };
  }
  const limit = getDiscountLimit(req);
  const subtotal = Math.max(0, Number(body.subtotal !== undefined ? body.subtotal : existing.subtotal) || 0);
  const maxDiscount = subtotal * (limit / 100);
  if (incoming > maxDiscount) {
    return { statusCode: 400, message: `Discount exceeds your role limit of ${limit}% (maximum Rs. ${Math.round(maxDiscount)}).` };
  }
  return null;
};

const runTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const resolveTable = async (tableId, tableName, session) => {
  if (tableId && mongoose.Types.ObjectId.isValid(tableId)) {
    const query = Table.findById(tableId);
    if (session) query.session(session);
    const byId = await query;
    if (byId) return byId;
  }
  if (!tableName) return null;
  const query = Table.findOne({ name: tableName });
  if (session) query.session(session);
  return query;
};

const tableMatch = (order) => order.tableId
  ? { _id: order.tableId }
  : { name: order.table };

const applyInventoryDeduction = async (order, userId) => {
  if (!order || order.inventoryDeducted) return false;
  try {
    await deductInventoryForOrder(order, userId);
    order.inventoryDeducted = true;
    emitPosChange(["inventory", "dashboard"]);
    return true;
  } catch (error) {
    console.error("Inventory deduction failed for order", order.code || order._id, error);
    return false;
  }
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeTableSearch = (query) => { 
  const q = String(query || "").trim().toUpperCase();
  const match = q.match(/^([MRBE])(\d+)$/);
  if (match) {
    const prefixMap = {
      'M': 'MH',
      'R': 'RT',
      'B': 'BT',
      'E': 'ET'
    };
    return `${prefixMap[match[1]]}-${match[2]}`;
  }
  return query.trim();
};

const applyBillingFieldsFromBody = (body, patch) => {
  if (body.gstEnabled !== undefined) {
    patch.gstEnabled = body.gstEnabled === true || body.gstEnabled === "true";
  }
  const numericFields = ["total", "subtotal", "discount", "tax", "gstAmount", "serviceCharge", "takeawayCharge", "amountPaid", "advanceAmount", "changeDue"];
  for (const f of numericFields) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== "") {
      const n = Number(body[f]);
      if (Number.isFinite(n)) patch[f] = n;
    }
  }
  if (body.takeawayChargeEnabled !== undefined) {
    patch.takeawayChargeEnabled = body.takeawayChargeEnabled === true || body.takeawayChargeEnabled === "true";
  }
  return patch;
};

const stampItemsForKitchen = (items, requestId, requestAt = new Date()) => {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => {
    // Correctly snapshot bundleItems if they exist
    const bundleItems = Array.isArray(item.menuItem?.bundleItems) 
      ? item.menuItem.bundleItems.map(bi => ({
          menuItem: typeof bi.menuItem === 'object' ? (bi.menuItem._id || bi.menuItem.id) : bi.menuItem,
          name: typeof bi.menuItem === 'object' ? bi.menuItem.name : (bi.name || ''),
          quantity: bi.quantity
        }))
      : [];

    return {
      ...item,
      menuItem: {
        ...(item.menuItem || {}),
        kitchenRequired: item.menuItem?.kitchenRequired !== false,
        isBundle: item.menuItem?.isBundle === true || bundleItems.length > 0,
        bundleItems,
      },
      requestId,
      requestAt,
    };
  });
};

exports.list = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};

    // Status & type filters
    if (req.query.status && req.query.status !== "all") where.status = String(req.query.status);
    if (req.query.type && req.query.type !== "all") where.type = String(req.query.type);
    if (req.query.orderTaker && req.query.orderTaker !== "all") where.orderTaker = String(req.query.orderTaker);

    // Date range filter
    const { from, to, today } = req.query;
    if (from || to) {
      const dateFilter = {};
      if (from) dateFilter.$gte = new Date(new Date(from).setHours(0, 0, 0, 0));
      if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      if (Object.keys(dateFilter).length) where.createdAt = dateFilter;
    } else if (today !== "false") {
      const now = new Date();
      where.createdAt = {
        $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      };
    }

    // Search logic
    if (req.query.search?.trim()) {
      const searchInput = req.query.search.trim();
      const normalizedSearch = normalizeTableSearch(searchInput);
      const isNormalized = normalizedSearch !== searchInput;
      
      const conditions = [];

      // Order code match
      conditions.push({ code: { $regex: escapeRegex(searchInput), $options: "i" } });

      // Table name match
      if (isNormalized) {
        // If it was normalized (e.g., M1 -> MH-1), use exact match for table
        conditions.push({ table: { $regex: `^${escapeRegex(normalizedSearch)}$`, $options: "i" } });
      } else {
        // Otherwise use loose regex match
        conditions.push({ table: { $regex: escapeRegex(searchInput), $options: "i" } });
      }

      if (conditions.length) where.$or = conditions;
    }

    // Floor filter
    if (req.query.floorKey && req.query.floorKey !== "all") {
      const tables = await Table.find({ floorKey: String(req.query.floorKey) }, { name: 1 }).lean();
      const tableNames = tables.map(t => t.name).filter(Boolean);
      if (!tableNames.length) return res.json(buildPaginatedResponse({ items: [], total: 0, page, limit }));
      where.table = { $in: tableNames };
    }

    // Execute query
    const [items, total, rates] = await Promise.all([
      Order.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(where),
      getEffectiveTaxRates()
    ]);

    const deliveryCodes = items.filter((o) => o.type === "delivery").map((o) => o.code);
    const deliveryRows = deliveryCodes.length
      ? await Delivery.find({ orderId: { $in: deliveryCodes } }).lean()
      : [];
    const deliveryByOrderId = new Map(deliveryRows.map((d) => [d.orderId, d]));

    // Format response
    res.json(buildPaginatedResponse({
      items: items.map(o => {
        const deliveryRow = deliveryByOrderId.get(o.code);
        const totals = calculateGrandTotal(o.items || [], o.tax, o.discount, o.gstEnabled, rates, o.type, o.takeawayChargeEnabled !== false);
        const isPaid = o.status === "completed";
        return {
          id: o.code,
          dbId: String(o._id),
          type: o.type,
          status: o.status,
          table: o.table,
          tableId: o.tableId ? String(o.tableId) : null,
          items: o.items || [],
          total: isPaid && Number.isFinite(o.total) ? Number(o.total) : totals.grandTotal,
          subtotal: totals.subtotal,
          tax: totals.tax,
          discount: isPaid && Number.isFinite(o.discount) ? Number(o.discount) : totals.discount,
          gstAmount: totals.gstAmount,
          serviceCharge: totals.serviceCharge,
          takeawayCharge: totals.takeawayCharge,
          gstEnabled: o.gstEnabled !== false,
          takeawayChargeEnabled: o.takeawayChargeEnabled !== false,
          createdAt: o.createdAt,
          customerName: o.customerName || deliveryRow?.customerName || "",
          phone: o.phone || deliveryRow?.phone || "",
          deliveryAddress: o.deliveryAddress || deliveryRow?.address || "",
          orderTaker: o.orderTaker || "",
          cashierName: o.cashierName || "",
          amountPaid: o.amountPaid,
          advanceAmount: o.advanceAmount || 0,
          changeDue: o.changeDue,
          paymentMethod: o.paymentMethod,
          staffMember: o.staffMember ? String(o.staffMember) : null,
          staffBillPaid: o.staffBillPaid || false
        };
      }),
      total,
      page,
      limit
    }));
  } catch (error) {
    console.error("List orders error:", error);
    res.status(500).json({ message: error.message || "Failed to fetch orders" });
  }
};

exports.patchStatus = async (req, res) => {
  try {
    const newStatus = String(req.body.status || "");
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const isSuperAdmin = isSuperAdminUser(req);

    // Restriction on completing order via patch (must go through payment)
    if (newStatus === "completed" && !isSuperAdmin) {
      return res.status(400).json({ message: "Order completion must be processed via payment on the billing panel." });
    }

    // Special logic for reverting status or modifying completed/cancelled orders
    if ((order.status === "completed" || order.status === "cancelled") && newStatus !== order.status) {
      if (!canAction(req, "revert_order")) {
        return res.status(403).json({ message: "You do not have permission to revise a completed or cancelled order." });
      }

      // If reverting to an active status, handle table re-occupation
      const activeStatuses = ["pending", "preparing", "ready", "served"];
      if (activeStatuses.includes(newStatus) && order.type === "dine-in" && order.table) {
        // Try to re-occupy the table if it's currently free
        const targetTable = await resolveTable(order.tableId, order.table);
        if (targetTable && (targetTable.status === "available" || targetTable.currentOrder === order.code)) {
          await Table.findOneAndUpdate(
            { _id: targetTable._id },
            { status: "occupied", currentOrder: order.code }
          );
        }
      }
    }

    order.status = newStatus;

    if (newStatus === "completed") {
      await applyInventoryDeduction(order, req.user?._id);
    }

    await order.save();

    // Safety: if status is changed to cancelled via patch, free the table
    if (newStatus === "cancelled" && order.type === "dine-in" && order.table) {
      await Table.findOneAndUpdate(
        { ...tableMatch(order), currentOrder: order.code }, 
        { status: "available", currentOrder: "" }
      );
    }

    broadcastOrderDomain();
    res.json({ ok: true, id: String(order._id), status: order.status });
  } catch (error) {
    console.error("Patch status error:", error);
    res.status(500).json({ message: error.message || "Failed to update order status" });
  }
};

exports.changeTable = async (req, res) => {
  try {
    const newTableName = req.body.table;
    const newTableId = req.body.tableId;
    if (!newTableName && !newTableId) {
      return res.status(400).json({ message: "Provide a valid table name." });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.type !== "dine-in") {
      return res.status(400).json({ message: "Only dine-in orders can be reassigned to a table." });
    }
    if (order.status === "completed" || order.status === "cancelled") {
      return res.status(400).json({ message: "Cannot switch table for a completed or cancelled order." });
    }

    const result = await runTransaction(async (session) => {
      const transactionalOrder = await Order.findById(req.params.id).session(session);
      const targetTable = await resolveTable(newTableId, newTableName, session);
      if (!targetTable) {
        const error = new Error("Target table not found.");
        error.statusCode = 404;
        throw error;
      }
      if (targetTable.status === "occupied" && targetTable.currentOrder !== transactionalOrder.code) {
        const error = new Error("Target table is currently occupied.");
        error.statusCode = 400;
        throw error;
      }
      if (transactionalOrder.tableId || transactionalOrder.table) {
        await Table.updateOne({ ...tableMatch(transactionalOrder), currentOrder: transactionalOrder.code }, { $set: { status: "available", currentOrder: "" } }, { session });
      }
      await Table.updateOne({ _id: targetTable._id }, { $set: { status: "occupied", currentOrder: transactionalOrder.code } }, { session });
      transactionalOrder.table = targetTable.name;
      transactionalOrder.tableId = targetTable._id;
      await transactionalOrder.save({ session });
      return transactionalOrder;
    });

    broadcastOrderDomain();
    res.json({ ok: true, table: result.table, tableId: String(result.tableId) });
  } catch (error) {
    console.error("Change table error:", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to change table" });
  }
};

exports.create = async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await runTransaction(async (session) => {
      const selectedTable = payload.type === "dine-in" ? await resolveTable(payload.tableId, payload.table) : null;
      if (payload.type === "dine-in" && !selectedTable) {
        const error = new Error("Selected table not found.");
        error.statusCode = 404;
        throw error;
      }
      if (selectedTable) {
        const existingOrder = await Order.findOne({
          $or: [{ tableId: selectedTable._id }, { table: selectedTable.name }],
          type: "dine-in",
          status: { $in: ["pending", "preparing", "ready", "served"] },
        }).session(session);
        if (existingOrder) {
          const error = new Error("This table already has an active order. Complete payment before creating a new order.");
          error.statusCode = 400;
          throw error;
        }
      }

      const code = payload.code || `ORD-${Date.now().toString().slice(-6)}`;
      const createdAt = new Date();
      const items = stampItemsForKitchen(payload.items, `${code}-R1`, createdAt);
      const rates = await getEffectiveTaxRates();
      const takeawayChargeEnabled = payload.takeawayChargeEnabled !== false;
      const totals = calculateGrandTotal(items, payload.tax, payload.discount, payload.gstEnabled ?? true, rates, payload.type || "dine-in", takeawayChargeEnabled);
      const [row] = await Order.create([{
        code,
        type: payload.type || "dine-in",
        status: payload.status || "pending",
        table: selectedTable?.name || payload.table,
        tableId: selectedTable?._id || null,
        customerName: payload.customerName || "",
        phone: payload.phone || "",
        deliveryAddress: payload.deliveryAddress || "",
        orderTaker: req.user.name || req.user.email || "Unknown",
        notes: payload.notes || "",
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discount,
        gstAmount: totals.gstAmount,
        serviceCharge: totals.serviceCharge,
        gstEnabled: payload.gstEnabled ?? true,
        takeawayChargeEnabled,
        paymentMethod: payload.paymentMethod || "cash",
        total: totals.grandTotal,
        advanceAmount: Number(payload.advanceAmount || 0),
        items,
      }], { session });

      if (selectedTable) {
        await Table.updateOne({ _id: selectedTable._id }, { $set: { status: "occupied", currentOrder: code } }, { session });
      }
      if (payload.type === "delivery") {
        await Delivery.create([{
          orderId: code,
          customerName: payload.customerName || "",
          phone: payload.phone || "",
          address: payload.deliveryAddress || "",
          items: Array.isArray(payload.items) ? payload.items.map((item) => item.menuItem?.name || "Unknown") : [],
          total: totals.grandTotal,
          status: "pending",
          assignedRider: payload.assignedRider || "",
          estimatedTime: payload.estimatedTime || "30 mins",
        }], { session });
      }
      return row;
    });
    broadcastOrderDomain();
    res.status(201).json({ id: result.code, dbId: String(result._id) });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to create order" });
  }
};

exports.openByTable = async (req, res) => {
  try {
    const tableIdentifier = req.params.tableNumber; // Now can be name or number
    const includeCompleted = String(req.query.includeCompleted || "") === "true";
    
    // We try to find by table field which now stores name
    const tableQuery = mongoose.Types.ObjectId.isValid(tableIdentifier)
      ? { tableId: tableIdentifier }
      : { table: tableIdentifier };
    const where = { ...tableQuery, type: "dine-in" };
    if (!includeCompleted) {
      where.status = { $nin: ["completed", "cancelled"] };
    }
    let row = await Order.findOne(where).sort({ createdAt: -1 }).lean();
    
    // Fallback: if not found by name, maybe it's an old order stored by number
    if (!row && !isNaN(Number(tableIdentifier))) {
      where.table = Number(tableIdentifier);
      row = await Order.findOne(where).sort({ createdAt: -1 }).lean();
    }

    if (!row) return res.json({ item: null });
    const rates = await getEffectiveTaxRates();
    const totals = calculateGrandTotal(row.items || [], row.tax, row.discount, row.gstEnabled, rates, row.type, row.takeawayChargeEnabled !== false);
    return res.json({
      item: {
        id: row.code,
        dbId: String(row._id),
        type: row.type,
        status: row.status,
        table: row.table,
        tableId: row.tableId ? String(row.tableId) : null,
        items: row.items || [],
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discount,
        gstAmount: totals.gstAmount,
        serviceCharge: totals.serviceCharge,
        gstEnabled: row.gstEnabled !== false,
        takeawayChargeEnabled: row.takeawayChargeEnabled !== false,
        total: totals.grandTotal,
        notes: row.notes || "",
        customerName: row.customerName || "",
        phone: row.phone || "",
        deliveryAddress: row.deliveryAddress || "",
        orderTaker: row.orderTaker || "",
        amountPaid: row.amountPaid,
        advanceAmount: row.advanceAmount || 0,
        changeDue: row.changeDue,
        paymentMethod: row.paymentMethod,
        cashierName: row.cashierName || "",
      },
    });
  } catch (error) {
    console.error("Open by table error:", error);
    res.status(500).json({ message: error.message || "Failed to fetch order by table" });
  }
};

exports.addItems = async (req, res) => {
  try {
    const row = await Order.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Order not found" });
    const wasCompleted = row.status === "completed";
    const isSuperAdmin = req.user && req.user.role === "superadmin";

    if (wasCompleted && !isSuperAdmin) {
      return res.status(403).json({ message: "Only superadmin can add items to a completed order." });
    }
    const incoming = Array.isArray(req.body.items) ? req.body.items : [];
    const requestNo = (row.items || []).reduce((max, item) => {
      const match = String(item.requestId || "").match(/-R(\d+)$/);
      const n = match ? Number(match[1]) : 0;
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 1);
    const requestId = `${row.code}-R${requestNo + 1}`;
    row.items = [...(row.items || []), ...stampItemsForKitchen(incoming, requestId)];
    row.takeawayChargeEnabled = req.body.takeawayChargeEnabled !== undefined ? (req.body.takeawayChargeEnabled === true || req.body.takeawayChargeEnabled === "true") : row.takeawayChargeEnabled;
    const rates = await getEffectiveTaxRates();
    const totals = calculateGrandTotal(row.items, req.body.tax ?? row.tax, req.body.discount ?? row.discount, req.body.gstEnabled ?? row.gstEnabled, rates, row.type, row.takeawayChargeEnabled !== false);
    row.subtotal = totals.subtotal;
    row.tax = totals.tax;
    row.discount = totals.discount;
    row.gstAmount = totals.gstAmount;
    row.serviceCharge = totals.serviceCharge;
    row.gstEnabled = req.body.gstEnabled ?? row.gstEnabled;
    row.advanceAmount = Number(req.body.advanceAmount ?? row.advanceAmount ?? 0);
    row.total = totals.grandTotal;
    row.notes = req.body.notes ?? row.notes;
    row.table = req.body.table ?? row.table;
    if (req.body.tableId && mongoose.Types.ObjectId.isValid(req.body.tableId)) row.tableId = req.body.tableId;
    row.status = "pending";
    if (!row.orderTaker || row.orderTaker === "Unknown") {
      row.orderTaker = req.user.name || req.user.email || "Unknown";
    }
    await row.save();
    if (row.type === "delivery") {
      await Delivery.findOneAndUpdate({ orderId: row.code }, { total: totals.grandTotal });
    }
    if (row.type === "dine-in" && row.table) {
      await Table.findOneAndUpdate(tableMatch(row), { status: "occupied", currentOrder: row.code });
    }
    if (wasCompleted && row.type === "dine-in" && row.table) {
      await Table.findOneAndUpdate(tableMatch(row), { status: "occupied", currentOrder: row.code });
    }
    broadcastOrderDomain();
    res.json({ ok: true, id: row.code, dbId: String(row._id) });
  } catch (error) {
    console.error("Add items error:", error);
    res.status(500).json({ message: error.message || "Failed to add items" });
  }
};

exports.editItems = async (req, res) => {
  try {
    const row = await Order.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Order not found" });
    const invalidStatuses = ["completed", "cancelled"];
    if (invalidStatuses.includes(row.status)) {
      return res.status(400).json({ message: "Cannot edit a completed or cancelled order." });
    }

    const incoming = Array.isArray(req.body.items) ? req.body.items : [];
    const requestNo = (row.items || []).reduce((max, item) => {
      const match = String(item.requestId || "").match(/-R(\d+)$/);
      const n = match ? Number(match[1]) : 0;
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 1);
    const requestId = `${row.code}-R${requestNo + 1}`;
    row.items = stampItemsForKitchen(incoming, requestId);
    row.takeawayChargeEnabled = req.body.takeawayChargeEnabled !== undefined ? (req.body.takeawayChargeEnabled === true || req.body.takeawayChargeEnabled === "true") : row.takeawayChargeEnabled;
    const rates = await getEffectiveTaxRates();
    const totals = calculateGrandTotal(
      row.items,
      req.body.tax ?? row.tax,
      req.body.discount ?? row.discount,
      req.body.gstEnabled ?? row.gstEnabled,
      rates,
      row.type,
      row.takeawayChargeEnabled !== false
    );
    row.subtotal = totals.subtotal;
    row.tax = totals.tax;
    row.discount = totals.discount;
    row.gstAmount = totals.gstAmount;
    row.serviceCharge = totals.serviceCharge;
    row.gstEnabled = req.body.gstEnabled ?? row.gstEnabled;
    row.advanceAmount = Number(req.body.advanceAmount ?? row.advanceAmount ?? 0);
    row.total = totals.grandTotal;
    row.notes = req.body.notes ?? row.notes;
    row.table = req.body.table ?? row.table;
    if (req.body.tableId && mongoose.Types.ObjectId.isValid(req.body.tableId)) row.tableId = req.body.tableId;
    if (!row.orderTaker || row.orderTaker === "Unknown") {
      row.orderTaker = req.user.name || req.user.email || "Unknown";
    }
    await row.save();
    if (row.type === "delivery") {
      await Delivery.findOneAndUpdate({ orderId: row.code }, { total: totals.grandTotal });
    }
    if (row.type === "dine-in" && row.table) {
      await Table.findOneAndUpdate(tableMatch(row), { status: "occupied", currentOrder: row.code });
    }
    broadcastOrderDomain();
    res.json({ ok: true, id: row.code, dbId: String(row._id) });
  } catch (error) {
    console.error("Edit items error:", error);
    res.status(500).json({ message: error.message || "Failed to edit order items" });
  }
};

exports.patchBillingTotals = async (req, res) => {
  try {
    const existing = await Order.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Order not found" });
    if (existing.status === "completed") {
      return res.status(400).json({ message: "Cannot update billing on a paid order" });
    }
    const discountError = checkDiscountChangeError(req, existing, req.body);
    if (discountError) {
      return res.status(discountError.statusCode).json({ message: discountError.message });
    }
    const patch = {};
    applyBillingFieldsFromBody(req.body, patch);
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ message: "Provide gstEnabled and/or numeric billing fields to update" });
    }
    const updated = await Order.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (updated.type === "delivery" && updated.code) {
      await Delivery.findOneAndUpdate({ orderId: updated.code }, { total: Number(updated.total || 0) });
    }
    broadcastOrderDomain();
    res.json({ ok: true });
  } catch (error) {
    console.error("Patch billing totals error:", error);
    res.status(500).json({ message: error.message || "Failed to update billing" });
  }
};

exports.payment = async (req, res) => {
  try {
    const row = await runTransaction(async (session) => {
      const transactionalRow = await Order.findById(req.params.id).session(session);
      if (!transactionalRow) {
        const error = new Error("Order not found");
        error.statusCode = 404;
        throw error;
      }
      const patch = { status: "completed", paymentMethod: req.body.paymentMethod || "cash" };
      const discountError = checkDiscountChangeError(req, transactionalRow, req.body);
      if (discountError) {
        const error = new Error(discountError.message);
        error.statusCode = discountError.statusCode;
        throw error;
      }
      applyBillingFieldsFromBody(req.body, patch);
      if (transactionalRow.staffMember) patch.staffBillPaid = true;
      if (req.user) patch.cashierName = req.user.name || req.user.email;
      Object.assign(transactionalRow, patch);
      await transactionalRow.save({ session });
      if (transactionalRow.type === "delivery" && transactionalRow.code) {
        await Delivery.updateOne({ orderId: transactionalRow.code }, { $set: { total: Number(transactionalRow.total || 0) } }, { session });
      }
      if (transactionalRow.type === "dine-in" && transactionalRow.table) {
        await Table.updateOne({ ...tableMatch(transactionalRow), currentOrder: transactionalRow.code }, { $set: { status: "available", currentOrder: "" } }, { session });
      }
      return transactionalRow;
    });
    await applyInventoryDeduction(row, req.user?._id);
    await row.save();

    broadcastOrderDomain();
    res.json({ ok: true });
  } catch (error) {
    console.error("Payment error:", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to process payment" });
  }
};

exports.cancel = async (req, res) => {
  try {
    await runTransaction(async (session) => {
      const row = await Order.findById(req.params.id).session(session);
      if (!row) {
        const error = new Error("Order not found");
        error.statusCode = 404;
        throw error;
      }
      if (row.status === "completed") {
        const error = new Error("Cannot cancel a completed/paid order");
        error.statusCode = 400;
        throw error;
      }
      row.status = "cancelled";
      await row.save({ session });
      if (row.type === "dine-in" && row.table) {
        await Table.updateOne({ ...tableMatch(row), currentOrder: row.code }, { $set: { status: "available", currentOrder: "" } }, { session });
      }
    });
    broadcastOrderDomain();
    res.json({ ok: true });
  } catch (error) {
    console.error("Cancel order error:", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to cancel order" });
  }
};

exports.switchType = async (req, res) => {
  try {
    const { type, table, tableId, customerName, phone, deliveryAddress } = req.body;
    if (!type) return res.status(400).json({ message: "Provide a valid order type." });

    const order = await runTransaction(async (session) => {
      const transactionalOrder = await Order.findById(req.params.id).session(session);
      if (!transactionalOrder) {
        const error = new Error("Order not found");
        error.statusCode = 404;
        throw error;
      }
      if (transactionalOrder.status === "completed" || transactionalOrder.status === "cancelled") {
        const error = new Error("Cannot switch type for a completed or cancelled order.");
        error.statusCode = 400;
        throw error;
      }
      if (transactionalOrder.type === "dine-in" && transactionalOrder.table && type !== "dine-in") {
        await Table.updateOne({ ...tableMatch(transactionalOrder), currentOrder: transactionalOrder.code }, { $set: { status: "available", currentOrder: "" } }, { session });
      }
      if (type === "dine-in") {
        if (!table && !tableId) {
          const error = new Error("Provide a table for dine-in order.");
          error.statusCode = 400;
          throw error;
        }
        const targetTable = await resolveTable(tableId, table, session);
        if (!targetTable) {
          const error = new Error("Target table not found.");
          error.statusCode = 404;
          throw error;
        }
        if (targetTable.status === "occupied" && targetTable.currentOrder !== transactionalOrder.code) {
          const error = new Error("Target table is currently occupied.");
          error.statusCode = 400;
          throw error;
        }
        await Table.updateOne({ _id: targetTable._id }, { $set: { status: "occupied", currentOrder: transactionalOrder.code } }, { session });
        transactionalOrder.table = targetTable.name;
        transactionalOrder.tableId = targetTable._id;
      } else {
        transactionalOrder.table = "";
        transactionalOrder.tableId = null;
      }
      transactionalOrder.type = type;
      if (type === "delivery") {
        if (customerName !== undefined) transactionalOrder.customerName = String(customerName || "").trim();
        if (phone !== undefined) transactionalOrder.phone = String(phone || "").trim();
        if (deliveryAddress !== undefined) transactionalOrder.deliveryAddress = String(deliveryAddress || "").trim();
      } else {
        transactionalOrder.phone = "";
        transactionalOrder.deliveryAddress = "";
      }
      const rates = await getEffectiveTaxRates();
      const totals = calculateGrandTotal(transactionalOrder.items || [], transactionalOrder.tax, transactionalOrder.discount, transactionalOrder.gstEnabled, rates, type, transactionalOrder.takeawayChargeEnabled !== false);
      transactionalOrder.subtotal = totals.subtotal;
      transactionalOrder.tax = totals.tax;
      transactionalOrder.discount = totals.discount;
      transactionalOrder.gstAmount = totals.gstAmount;
      transactionalOrder.serviceCharge = totals.serviceCharge;
      transactionalOrder.total = totals.grandTotal;
      await transactionalOrder.save({ session });
      if (type === "delivery") {
        const deliveryPayload = { customerName: transactionalOrder.customerName || "", phone: transactionalOrder.phone || "", address: transactionalOrder.deliveryAddress || "", items: (transactionalOrder.items || []).map((item) => item.menuItem?.name || "Unknown"), total: Number(transactionalOrder.total || 0) };
        await Delivery.updateOne({ orderId: transactionalOrder.code }, { $set: deliveryPayload, $setOnInsert: { status: "pending", estimatedTime: "30 mins" } }, { upsert: true, session });
      } else {
        await Delivery.deleteOne({ orderId: transactionalOrder.code }, { session });
      }
      return transactionalOrder;
    });

    broadcastOrderDomain();
    res.json({ ok: true, type: order.type, table: order.table, tableId: order.tableId ? String(order.tableId) : null, total: order.total });
  } catch (error) {
    console.error("Switch type error:", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to switch order type" });
  }
};

exports.remove = async (req, res) => {
  try {
    if (!canAction(req, "delete_order")) {
      return res.status(403).json({ message: "You do not have permission to delete orders." });
    }
    await runTransaction(async (session) => {
      const row = await Order.findById(req.params.id).session(session);
      if (!row) {
        const error = new Error("Order not found");
        error.statusCode = 404;
        throw error;
      }
      if (row.type === "dine-in" && row.table) {
        await Table.updateOne({ ...tableMatch(row), currentOrder: row.code }, { $set: { status: "available", currentOrder: "" } }, { session });
      }
      await Order.deleteOne({ _id: row._id }, { session });
    });
    broadcastOrderDomain();
    res.json({ ok: true });
  } catch (error) {
    console.error("Remove order error:", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to remove order" });
  }
};

// ─── Staff Bills Endpoints ──────────────────────────────────────────────────

exports.assignStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const { staffMember } = req.body;

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.staffMember = staffMember || null;
    await order.save();

    broadcastOrderDomain();
    res.json({ ok: true, staffMember: order.staffMember });
  } catch (error) {
    console.error("Assign staff error:", error);
    res.status(500).json({ message: error.message || "Failed to assign staff" });
  }
};

exports.staffSummary = async (req, res) => {
  try {
    const summary = await Order.aggregate([
      { $match: { staffMember: { $ne: null }, status: { $ne: "cancelled" } } },
      {
        $group: {
          _id: "$staffMember",
          pendingCount: {
            $sum: { $cond: [{ $eq: ["$staffBillPaid", false] }, 1, 0] }
          },
          pendingTotal: {
            $sum: { $cond: [{ $eq: ["$staffBillPaid", false] }, "$total", 0] }
          },
          paidCount: {
            $sum: { $cond: [{ $eq: ["$staffBillPaid", true] }, 1, 0] }
          },
          paidTotal: {
            $sum: { $cond: [{ $eq: ["$staffBillPaid", true] }, "$total", 0] }
          },
          lastOrderDate: { $max: "$createdAt" },
        }
      },
      {
        $lookup: {
          from: "employees",
          localField: "_id",
          foreignField: "_id",
          as: "employee"
        }
      },
      { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: { $ifNull: ["$employee.name", "Unknown"] },
          role: { $ifNull: ["$employee.role", "Staff"] },
          pendingCount: 1,
          pendingTotal: 1,
          paidCount: 1,
          paidTotal: 1,
          lastOrderDate: 1,
        }
      },
      { $sort: { pendingTotal: -1 } }
    ]);

    res.json({ staff: summary });
  } catch (error) {
    console.error("Staff summary error:", error);
    res.status(500).json({ message: error.message || "Failed to get staff summary" });
  }
};

exports.staffBills = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {
      staffMember: { $ne: null },
      status: { $ne: "cancelled" },
    };

    if (req.query.employeeId) where.staffMember = req.query.employeeId;
    if (req.query.status && req.query.status !== "all") {
      where.staffBillPaid = req.query.status === "paid";
    }

    // Date range filter
    const { from, to } = req.query;
    if (from || to) {
      const dateFilter = {};
      if (from) dateFilter.$gte = new Date(new Date(from).setHours(0, 0, 0, 0));
      if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      if (Object.keys(dateFilter).length) where.createdAt = dateFilter;
    }

    const [items, total] = await Promise.all([
      Order.find(where)
        .populate("staffMember", "name role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(where),
    ]);

    res.json(buildPaginatedResponse({ items, total, page, limit }));
  } catch (error) {
    console.error("Staff bills error:", error);
    res.status(500).json({ message: error.message || "Failed to get staff bills" });
  }
};

exports.markStaffPaid = async (req, res) => {
  try {
    const { id } = req.params;
    if (!canAccessStaffBills(req)) {
      return res.status(403).json({ message: "You do not have permission to manage staff bills." });
    }

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (!order.staffMember) return res.status(400).json({ message: "This order is not assigned to any staff member" });

    order.staffBillPaid = true;
    order.status = "completed";
    await order.save();

    broadcastOrderDomain();
    res.json({ ok: true, staffBillPaid: true });
  } catch (error) {
    console.error("Mark staff paid error:", error);
    res.status(500).json({ message: error.message || "Failed to mark as paid" });
  }
};
