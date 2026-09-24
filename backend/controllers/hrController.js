const { parsePagination, buildPaginatedResponse } = require("../utils/pagination");
const { emitPosChange } = require("../utils/realtime");
const { Employee, Attendance, LeaveRequest, LeaveBalance, SalaryRecord, SalaryPayment, Shift, Order } = require("../models");

const currentMonthKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

// Payroll tracking starts here. Older salary rows from the previous HR screen are ignored.
const PAYROLL_START_MONTH = "2026-09";

const shiftMonth = (month, delta) => {
  const [year, mon] = String(month || currentMonthKey()).split("-").map(Number);
  const next = new Date(year, mon - 1 + delta, 1);
  return currentMonthKey(next);
};

const computeNet = (row) =>
  Number(row.baseSalary || 0) + Number(row.bonus || 0) - Number(row.deductions || 0) - Number(row.lateFines || 0);

const paidTowardsMonth = (payments, month) =>
  payments.filter((p) => p.forMonth === month).reduce((sum, p) => sum + Number(p.amount || 0), 0);

const payrollStatus = (net, paid) => {
  if (paid <= 0) return "pending";
  if (paid >= net) return "paid";
  return "partial";
};

// Monthly salary: base/bonus figures are not extra cash. He receives the net.
const cashHeReceives = (type, amount, record) => {
  if (type !== "salary" || !(amount > 0) || !record) return amount;
  const net = computeNet(record);
  const base = Number(record.baseSalary || 0);
  const bonus = Number(record.bonus || 0);
  if (amount > net && (amount === base || amount === base + bonus)) return net;
  return amount;
};

const staffLookupKeys = (emp) => {
  const keys = [String(emp._id || emp.id || "")];
  if (emp.employeeId) keys.push(String(emp.employeeId));
  return keys.filter(Boolean);
};

const staffMap = (employees) => {
  const map = new Map();
  employees.forEach((emp) => {
    staffLookupKeys(emp).forEach((key) => map.set(key, emp));
  });
  return map;
};

// Soft-deleted (inactive) and missing employees must never appear in payroll lists.
const isActiveEmployee = (emp) => Boolean(emp) && emp.status !== "inactive";

const activeEmployeesById = async () => {
  const employees = await Employee.find({ status: { $ne: "inactive" } }).lean();
  return staffMap(employees);
};

const staffFields = (employeeId, employeesById) => {
  const emp = employeesById.get(String(employeeId || ""));
  return {
    employeeId: String(employeeId || ""),
    employeeName: emp?.name || "",
    employeeRole: emp?.role || "",
    employeeCode: emp?.employeeId || "",
  };
};

const decorateRecord = (record, payments, employeesById = new Map()) => {
  const netSalary = computeNet(record);
  const paidAmount = paidTowardsMonth(payments, record.month);
  const remaining = Math.max(0, netSalary - paidAmount);
  const extraPaid = Math.max(0, paidAmount - netSalary);
  const advanceGiven = payments
    .filter((p) => p.type === "advance" && String(p.paidOn || "").slice(0, 7) === record.month && p.forMonth !== record.month)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const advanceCredit = payments
    .filter((p) => p.forMonth === record.month && (p.type === "advance" || String(p.paidOn || "").slice(0, 7) !== record.month))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const advanceMap = new Map();
  payments
    .filter((p) => p.type === "advance" && p.forMonth !== record.month && String(p.paidOn || "").slice(0, 7) === record.month)
    .forEach((p) => {
      const key = p.forMonth;
      advanceMap.set(key, (advanceMap.get(key) || 0) + Number(p.amount || 0));
    });
  const advanceDetails = [...advanceMap.entries()].map(([forMonth, amount]) => ({ forMonth, amount }));
  const status = payrollStatus(netSalary, paidAmount);
  return {
    ...record,
    id: String(record._id || record.id),
    ...staffFields(record.employeeId, employeesById),
    baseSalary: Number(record.baseSalary || 0),
    bonus: Number(record.bonus || 0),
    deductions: Number(record.deductions || 0),
    lateFines: Number(record.lateFines || 0),
    netSalary,
    paidAmount,
    remaining,
    extraPaid,
    advanceGiven,
    advanceCredit,
    advanceDetails,
    status,
    paidOn: record.paidOn || (status === "paid" ? payments.filter((p) => p.forMonth === record.month).at(-1)?.paidOn : undefined),
  };
};

const ensureMonthRecords = async (month) => {
  if (String(month) < PAYROLL_START_MONTH) return;
  const employees = await Employee.find({ status: "active" }).lean();
  const existing = await SalaryRecord.find({ month }).select("employeeId").lean();
  const have = new Set(existing.map((row) => String(row.employeeId)));
  const missing = employees.filter((emp) => !have.has(String(emp._id)));
  if (!missing.length) return;
  await SalaryRecord.insertMany(
    missing.map((emp) => ({
      employeeId: String(emp._id),
      month,
      baseSalary: Number(emp.salary || 0),
      bonus: 0,
      deductions: 0,
      lateFines: 0,
      netSalary: Number(emp.salary || 0),
      status: "pending",
    })),
    { ordered: false }
  ).catch(() => {});
};

exports.listEmployees = async (req, res) => {
  const where = {};
  // By default only show active employees
  if (!req.query.includeInactive) where.status = "active";
  if (req.query.search) where.$or = [{ name: { $regex: String(req.query.search), $options: "i" } }, { employeeId: { $regex: String(req.query.search), $options: "i" } }];
  const items = await Employee.find(where).sort({ createdAt: -1 }).lean();
  res.json({ items: items.map((i) => ({ ...i, id: String(i._id) })) });
};

exports.createEmployee = async (req, res) => {
  const payload = {
    ...req.body,
    salary: Number(req.body.salary || 0),
    joinDate: req.body.joinDate || new Date().toISOString().slice(0, 10),
    avatar: req.file ? `/uploads/staff/${req.file.filename}` : req.body.avatar || undefined,
  };
  const row = await Employee.create(payload);
  await LeaveBalance.create({ employeeId: String(row._id), sick: 8, casual: 6, annual: 10, emergency: 2 });
  await SalaryRecord.create({
    employeeId: String(row._id),
    month: new Date().toISOString().slice(0, 7),
    baseSalary: row.salary || 0,
    bonus: 0,
    deductions: 0,
    lateFines: 0,
    netSalary: row.salary || 0,
    status: "pending",
  });
  emitPosChange(["hr", "dashboard"]);
  res.status(201).json({ ...row.toObject(), id: String(row._id) });
};

exports.updateEmployee = async (req, res) => {
  const updateData = {
    ...req.body,
    salary: req.body.salary !== undefined ? Number(req.body.salary || 0) : undefined,
  };
  if (req.file) {
    updateData.avatar = `/uploads/staff/${req.file.filename}`;
  }
  const row = await Employee.findByIdAndUpdate(req.params.id, updateData, { new: true }).lean();
  if (!row) return res.status(404).json({ message: 'Employee not found' });
  emitPosChange(["hr", "dashboard"]);
  res.json({ ...row, id: String(row._id) });
};

exports.deleteEmployee = async (req, res) => {
  const row = await Employee.findById(req.params.id);
  if (!row) return res.status(404).json({ message: 'Employee not found' });

  // Check for pending staff bills
  const pendingBills = await Order.countDocuments({
    staffMember: row._id,
    staffBillPaid: false,
    status: { $ne: "cancelled" },
  });
  if (pendingBills > 0) {
    return res.status(400).json({ message: `Cannot delete: ${pendingBills} pending bill(s) must be settled first` });
  }

  // Soft delete
  row.status = "inactive";
  await row.save();
  emitPosChange(["hr", "dashboard"]);
  res.json({ ok: true });
};

exports.getAttendanceByDate = async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const items = await Attendance.find({ date }).lean();
  res.json({ items: items.map((i) => ({ ...i, id: String(i._id) })) });
};

exports.listLeaves = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const [rows, total] = await Promise.all([
    LeaveRequest.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    LeaveRequest.countDocuments({})
  ]);
  res.json(buildPaginatedResponse({ items: rows.map((i) => ({ ...i, id: String(i._id) })), total, page, limit }));
};

exports.patchLeaveStatus = async (req, res) => {
  await LeaveRequest.findByIdAndUpdate(req.params.id, { status: req.body.status });
  emitPosChange(["hr"]);
  res.json({ ok: true });
};

exports.listLeaveBalances = async (_req, res) => {
  const rows = await LeaveBalance.find({}).lean();
  res.json({ items: rows.map((i) => ({ ...i, id: String(i._id) })) });
};

exports.listSalary = async (req, res) => {
  const month = String(req.query.month || currentMonthKey());
  await ensureMonthRecords(month);
  const employeesById = await activeEmployeesById();
  const allRows = await SalaryRecord.find({ month }).lean();
  // Hide orphan rows and soft-deleted employees from the payroll table.
  const rows = allRows.filter((row) => isActiveEmployee(employeesById.get(String(row.employeeId || ""))));
  const employeeIds = [...new Set(rows.map((row) => String(row.employeeId)))];
  const payments = await SalaryPayment.find({ employeeId: { $in: employeeIds } }).sort({ paidOn: 1, createdAt: 1 }).lean();
  const paymentsByEmployee = new Map();
  payments.forEach((payment) => {
    const key = String(payment.employeeId);
    if (!paymentsByEmployee.has(key)) paymentsByEmployee.set(key, []);
    paymentsByEmployee.get(key).push(payment);
  });

  const priorRecords = await SalaryRecord.find({
    employeeId: { $in: employeeIds },
    month: { $lt: month, $gte: PAYROLL_START_MONTH },
  }).lean();
  const itemsWithArrears = rows.map((row) => {
    const empPayments = paymentsByEmployee.get(String(row.employeeId)) || [];
    const decorated = decorateRecord(row, empPayments, employeesById);
    const arrears = priorRecords
      .filter((prior) => String(prior.employeeId) === String(row.employeeId))
      .reduce((sum, prior) => sum + Math.max(0, computeNet(prior) - paidTowardsMonth(empPayments, prior.month)), 0);
    return { ...decorated, arrears };
  });

  const summary = itemsWithArrears.reduce(
    (acc, item) => ({
      due: acc.due + item.netSalary,
      paid: acc.paid + item.paidAmount,
      remaining: acc.remaining + item.remaining,
      advances: acc.advances + item.advanceGiven,
      arrears: acc.arrears + item.arrears,
    }),
    { due: 0, paid: 0, remaining: 0, advances: 0, arrears: 0 }
  );

  res.json({ month, items: itemsWithArrears, summary });
};

exports.patchSalary = async (req, res) => {
  const month = String(req.body.month || currentMonthKey());
  await ensureMonthRecords(month);
  const employee = await Employee.findById(req.params.employeeId).lean();
  if (!isActiveEmployee(employee)) return res.status(404).json({ message: "Employee not found" });
  const row = await SalaryRecord.findOne({ employeeId: req.params.employeeId, month });
  if (!row) return res.status(404).json({ message: "Salary row not found for this month" });
  if (req.body.bonus !== undefined) row.bonus = Number(req.body.bonus || 0);
  if (req.body.deductions !== undefined) row.deductions = Number(req.body.deductions || 0);
  if (req.body.lateFines !== undefined) row.lateFines = Number(req.body.lateFines || 0);
  row.netSalary = computeNet(row);
  await row.save();
  emitPosChange(["hr"]);
  res.json({ ok: true, item: { ...row.toObject(), id: String(row._id), netSalary: row.netSalary } });
};

exports.recordSalaryPayment = async (req, res) => {
  const employeeId = String(req.params.employeeId);
  const amount = Number(req.body.amount || 0);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const hasAdjustments = req.body.baseSalary !== undefined || req.body.bonus !== undefined || req.body.deductions !== undefined || req.body.lateFines !== undefined;
  if (!hasAmount && !hasAdjustments) {
    return res.status(400).json({ message: "Enter a payment amount or salary adjustment" });
  }
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) return res.status(404).json({ message: "Employee not found" });
  if (!isActiveEmployee(employee)) return res.status(400).json({ message: "Employee is inactive" });

  const paidOn = String(req.body.paidOn || new Date().toISOString().slice(0, 10));
  const selectedMonth = String(req.body.month || currentMonthKey());
  const type = req.body.type === "advance" ? "advance" : "salary";
  const forMonth = String(req.body.forMonth || (type === "advance" ? shiftMonth(selectedMonth, 1) : selectedMonth));
  const note = String(req.body.note || "");

  await ensureMonthRecords(forMonth);
  const record = await SalaryRecord.findOne({ employeeId, month: forMonth });
  if (record && hasAdjustments) {
    if (req.body.baseSalary !== undefined) record.baseSalary = Number(req.body.baseSalary || 0);
    if (req.body.bonus !== undefined) record.bonus = Number(req.body.bonus || 0);
    if (req.body.deductions !== undefined) record.deductions = Number(req.body.deductions || 0);
    if (req.body.lateFines !== undefined) record.lateFines = Number(req.body.lateFines || 0);
    record.netSalary = computeNet(record);
    await record.save();
  }

  const created = [];
  const receiveAmount = cashHeReceives(type, amount, record);
  if (hasAmount && receiveAmount > 0) {
    created.push(await SalaryPayment.create({ employeeId, amount: receiveAmount, type, forMonth, paidOn, note }));
  }

  if (record) {
    const latest = await SalaryPayment.find({ employeeId, forMonth }).lean();
    const paidAmount = paidTowardsMonth(latest, forMonth);
    const net = computeNet(record);
    record.netSalary = net;
    record.status = payrollStatus(net, paidAmount);
    if (record.status === "paid") record.paidOn = paidOn;
    await record.save();
  }

  emitPosChange(["hr"]);
  res.status(201).json({
    ok: true,
    payments: created.map((row) => ({ ...row.toObject(), id: String(row._id) })),
  });
};

exports.markSalaryPaid = async (req, res) => {
  const employeeId = String(req.params.employeeId);
  const month = String(req.body.month || currentMonthKey());
  await ensureMonthRecords(month);
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) return res.status(404).json({ message: "Employee not found" });
  if (!isActiveEmployee(employee)) return res.status(400).json({ message: "Employee is inactive" });
  const row = await SalaryRecord.findOne({ employeeId, month });
  if (!row) return res.status(404).json({ message: "Salary row not found for this month" });
  const payments = await SalaryPayment.find({ employeeId, forMonth: month }).lean();
  const remaining = Math.max(0, computeNet(row) - paidTowardsMonth(payments, month));
  if (remaining > 0) {
    await SalaryPayment.create({
      employeeId,
      amount: remaining,
      type: "salary",
      forMonth: month,
      paidOn: new Date().toISOString().slice(0, 10),
      note: "Marked paid in full",
    });
  }
  row.status = "paid";
  row.paidOn = new Date().toISOString().slice(0, 10);
  row.netSalary = computeNet(row);
  await row.save();
  emitPosChange(["hr"]);
  res.json({ ok: true });
};

exports.listSalaryPayments = async (req, res) => {
  const where = {};
  if (req.query.employeeId) where.employeeId = String(req.query.employeeId);
  if (req.query.from || req.query.to) {
    where.paidOn = {};
    if (req.query.from) where.paidOn.$gte = String(req.query.from);
    if (req.query.to) where.paidOn.$lte = String(req.query.to);
  }
  const employeesById = await activeEmployeesById();
  const rows = (await SalaryPayment.find(where).sort({ paidOn: -1, createdAt: -1 }).lean())
    .filter((row) => isActiveEmployee(employeesById.get(String(row.employeeId || ""))));
  res.json({
    items: rows.map((row) => ({
      ...row,
      id: String(row._id),
      ...staffFields(row.employeeId, employeesById),
    })),
  });
};

exports.listSalaryHistory = async (req, res) => {
  const employeeId = String(req.params.employeeId);
  const employeesById = await activeEmployeesById();
  const employee = employeesById.get(employeeId);
  if (!isActiveEmployee(employee)) {
    return res.status(404).json({ message: "Employee not found" });
  }
  const [records, payments] = await Promise.all([
    SalaryRecord.find({ employeeId }).sort({ month: -1 }).lean(),
    SalaryPayment.find({ employeeId }).sort({ paidOn: -1, createdAt: -1 }).lean(),
  ]);
  res.json({
    items: records.map((row) => decorateRecord(row, payments, employeesById)),
    payments: payments.map((row) => ({ ...row, id: String(row._id), ...staffFields(row.employeeId, employeesById) })),
  });
};

exports.listShifts = async (_req, res) => {
  const rows = await Shift.find({}).lean();
  res.json({ items: rows.map((i) => ({ ...i, id: String(i._id) })) });
};
