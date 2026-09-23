import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, History, Search, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/api';
import { usePosRealtimeScopes } from '@/hooks/pos/use-pos-realtime';
import type {
  Employee,
  PayrollSummary,
  SalaryHistoryResponse,
  SalaryPayment,
  SalaryPaymentType,
  SalaryRecord,
} from '@/data/hr/hrData';

const emptySummary: PayrollSummary = { due: 0, paid: 0, remaining: 0, advances: 0, arrears: 0 };

const currentMonthKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const shiftMonth = (month: string, delta: number) => {
  const [year, mon] = month.split('-').map(Number);
  const next = new Date(year, mon - 1 + delta, 1);
  return currentMonthKey(next);
};

const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString('en', { month: 'long', year: 'numeric' });

const rs = (value = 0) => `Rs ${Number(value || 0).toLocaleString('en-US')}`;

const digitsOnly = (value: string) => String(value || '').replace(/[^\d]/g, '');
const moneyDisplay = (value: string) => {
  const digits = digitsOnly(value);
  if (!digits) return '';
  return Number(digits).toLocaleString('en-US');
};
const moneyNumber = (value: string) => Number(digitsOnly(value) || 0);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const splitMonthKey = (key: string) => {
  const [year, mon] = String(key || currentMonthKey()).split('-');
  return { year: year || String(new Date().getFullYear()), month: (mon || '01').padStart(2, '0') };
};

const joinMonthKey = (year: string, month: string) => `${year}-${String(month).padStart(2, '0')}`;

const yearOptions = (selectedYear: string) => {
  const current = new Date().getFullYear();
  const selected = Number(selectedYear) || current;
  const start = Math.min(current - 3, selected);
  const end = Math.max(current + 2, selected);
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
};

const statusClass: Record<SalaryRecord['status'], string> = {
  paid: 'bg-primary/10 text-primary',
  partial: 'bg-warning/10 text-warning',
  pending: 'bg-destructive/10 text-destructive',
};

const cashHeReceives = (type: SalaryPaymentType, amount: number, base: number, bonus: number, net: number) => {
  if (type !== 'salary' || amount <= 0) return amount;
  if (amount > net && (amount === base || amount === base + bonus)) return net;
  return amount;
};

const rowMath = (row: SalaryRecord) => {
  const net = Math.max(
    0,
    Number(row.baseSalary || 0) + Number(row.bonus || 0) - Number(row.deductions || 0) - Number(row.lateFines || 0)
  );
  const paid = Number(row.paidAmount || 0);
  const remaining = Math.max(0, net - paid);
  const extra = Math.max(0, paid - net);
  const status: SalaryRecord['status'] = paid <= 0 ? 'pending' : paid >= net && net > 0 ? 'paid' : 'partial';
  return { net, paid, remaining, extra, status };
};

const receivedLabel = (row: SalaryRecord) => {
  const { extra, remaining, status } = rowMath(row);
  if (status === 'paid' && extra > 0) return `Received ${monthLabel(row.month)} salary + extra ${rs(extra)}`;
  if (status === 'paid') return `Received ${monthLabel(row.month)} salary`;
  if (status === 'partial') return `Partial ${monthLabel(row.month)} · ${rs(remaining)} unpaid`;
  return `Not received ${monthLabel(row.month)} salary`;
};

type PayDialog = {
  employeeId: string;
};

type PayrollView = 'month' | 'history';

export function PayrollTab({ employees }: { employees: Employee[] }) {
  const [view, setView] = useState<PayrollView>('history');
  const [month, setMonth] = useState(currentMonthKey);
  const [search, setSearch] = useState('');
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(null);
  const [records, setRecords] = useState<SalaryRecord[]>([]);
  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [summary, setSummary] = useState<PayrollSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [payDialog, setPayDialog] = useState<PayDialog | null>(null);
  const [payType, setPayType] = useState<SalaryPaymentType>('salary');
  const [payAmount, setPayAmount] = useState('');
  const [payForMonth, setPayForMonth] = useState(month);
  const [payNote, setPayNote] = useState('');
  const [payBase, setPayBase] = useState('');
  const [payBonus, setPayBonus] = useState('');
  const [payDeduction, setPayDeduction] = useState('');
  const [payLateFine, setPayLateFine] = useState('');
  const [payHistory, setPayHistory] = useState<SalaryHistoryResponse | null>(null);

  const getEmployee = useCallback((id: string) => {
    const key = String(id || '');
    return employees.find((emp) => {
      const empId = String(emp.id || (emp as Employee & { _id?: string })._id || '');
      return empId === key || String(emp.employeeId || '') === key;
    });
  }, [employees]);

  const staffName = useCallback((employeeId: string, fallback?: { employeeName?: string; employeeRole?: string; employeeCode?: string }) => {
    const emp = getEmployee(employeeId);
    return {
      name: emp?.name || fallback?.employeeName || 'Unknown staff',
      role: emp?.role || fallback?.employeeRole || fallback?.employeeCode || '',
    };
  }, [getEmployee]);

  const loadPayroll = useCallback(() => {
    setLoading(true);
    const employeeQuery = historyEmployeeId ? `?employeeId=${historyEmployeeId}` : '';
    Promise.all([
      api<{ month: string; items: SalaryRecord[]; summary: PayrollSummary }>(`/hr/salary?month=${month}`),
      api<{ items: SalaryPayment[] }>(`/hr/salary/payments${employeeQuery}`),
    ])
      .then(([salaryRes, paymentsRes]) => {
        setRecords(salaryRes.items || []);
        setSummary(salaryRes.summary || emptySummary);
        setPayments(paymentsRes.items || []);
      })
      .catch(() => toast.error('Failed to load payroll'))
      .finally(() => setLoading(false));
  }, [historyEmployeeId, month]);

  useEffect(() => {
    loadPayroll();
  }, [loadPayroll]);

  usePosRealtimeScopes(['hr'], loadPayroll);

  const matchesSearch = useCallback((employeeId: string) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const emp = getEmployee(employeeId);
    if (!emp) return false;
    return emp.name.toLowerCase().includes(q) || (emp.employeeId || '').toLowerCase().includes(q);
  }, [getEmployee, search]);

  const rows = useMemo(() => {
    const rank = { pending: 0, partial: 1, paid: 2 };
    return records
      .filter((row) => matchesSearch(row.employeeId))
      .sort((a, b) => (rank[a.status] ?? 0) - (rank[b.status] ?? 0));
  }, [matchesSearch, records]);

  const historyRows = useMemo(
    () => payments.filter((payment) => matchesSearch(payment.employeeId)),
    [matchesSearch, payments]
  );

  const fillAdjustments = (row?: SalaryRecord, fallbackBase?: number) => {
    setPayBase(row?.baseSalary != null ? String(row.baseSalary) : fallbackBase ? String(fallbackBase) : '');
    setPayBonus(row?.bonus ? String(row.bonus) : '');
    setPayDeduction(row?.deductions ? String(row.deductions) : '');
    setPayLateFine(row?.lateFines ? String(row.lateFines) : '');
  };

  const openPay = (row: SalaryRecord) => {
    setPayDialog({ employeeId: row.employeeId });
    setPayType('salary');
    setPayAmount('');
    setPayForMonth(month);
    setPayNote('');
    fillAdjustments(row);
    setPayHistory(null);
    api<SalaryHistoryResponse>(`/hr/salary/${row.employeeId}/history`)
      .then((res) => setPayHistory(res))
      .catch(() => setPayHistory({ items: [row], payments: [] }));
  };

  const changePayType = (type: SalaryPaymentType) => {
    setPayType(type);
    const nextMonth = type === 'advance' ? shiftMonth(month, 1) : month;
    setPayForMonth(nextMonth);
    fillAdjustments(type === 'salary' ? records.find((row) => row.employeeId === payDialog?.employeeId) : undefined);
  };

  const submitPayment = () => {
    if (!payDialog) return;
    const typedAmount = moneyNumber(payAmount);
    const net = Math.max(0, moneyNumber(payBase) + moneyNumber(payBonus) - moneyNumber(payDeduction) - moneyNumber(payLateFine));
    const amount = cashHeReceives(payType, typedAmount, moneyNumber(payBase), moneyNumber(payBonus), net);
    const hasAmount = amount > 0;
    if (!hasAmount && digitsOnly(payAmount)) {
      toast.error('Enter a valid amount');
      return;
    }
    api(`/hr/salary/${payDialog.employeeId}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount: hasAmount ? amount : 0,
        type: payType,
        month,
        forMonth: payForMonth,
        note: payNote,
        baseSalary: moneyNumber(payBase),
        bonus: moneyNumber(payBonus),
        deductions: moneyNumber(payDeduction),
        lateFines: moneyNumber(payLateFine),
      }),
    })
      .then(() => {
        toast.success(hasAmount ? (payType === 'advance' ? 'Advance recorded' : 'Payment recorded') : 'Salary adjustments saved');
        setPayDialog(null);
        setPayHistory(null);
        loadPayroll();
      })
      .catch((err) => toast.error(err.message || 'Failed to record payment'));
  };

  const openHistory = (employeeId?: string) => {
    setHistoryEmployeeId(employeeId || null);
    setView('history');
  };

  const payTarget = payDialog ? records.find((row) => row.employeeId === payDialog.employeeId) : null;
  const payEmployee = payDialog ? getEmployee(payDialog.employeeId) : null;
  const payEmployeeName = payEmployee?.name || payTarget?.employeeName || 'Staff';
  const historyEmployee = historyEmployeeId ? getEmployee(historyEmployeeId) : null;
  const selectedHistory = payHistory?.items.find((row) => row.month === payForMonth);
  const liveBase = moneyNumber(payBase);
  const liveBonus = moneyNumber(payBonus);
  const liveDeduction = moneyNumber(payDeduction);
  const liveFine = moneyNumber(payLateFine);
  const liveNet = Math.max(0, liveBase + liveBonus - liveDeduction - liveFine);
  const alreadyPaid = Number((payForMonth === month ? payTarget?.paidAmount : selectedHistory?.paidAmount) || 0);
  const liveRemaining = Math.max(0, liveNet - alreadyPaid);
  const typedAmount = moneyNumber(payAmount);
  const enteringAmount = cashHeReceives(payType, typedAmount, liveBase, liveBonus, liveNet);
  const afterPaid = alreadyPaid + enteringAmount;
  const afterRemaining = Math.max(0, liveNet - afterPaid);
  const extraPaid = Math.max(0, alreadyPaid - liveNet);
  const afterExtra = Math.max(0, afterPaid - liveNet);
  const selectedStatus: SalaryRecord['status'] = alreadyPaid <= 0 ? 'pending' : alreadyPaid >= liveNet && liveNet > 0 ? 'paid' : 'partial';
  const receivedMonths = (payHistory?.items || []).filter((row) => (row.paidAmount || 0) > 0);

  useEffect(() => {
    if (!payDialog || payType !== 'salary') return;
    const remaining = Math.max(0, liveNet - alreadyPaid);
    setPayAmount(remaining > 0 ? String(remaining) : '');
  }, [alreadyPaid, liveNet, payDialog, payType]);

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Payroll</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Full payment history is the main ledger. Use this month when you need to record a new pay.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-muted rounded-xl p-1">
              <button type="button" onClick={() => openHistory()} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === 'history' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}>
                Payment history
              </button>
              <button type="button" onClick={() => setView('month')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === 'month' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}>
                This month
              </button>
            </div>
            {view === 'month' && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setMonth((prev) => shiftMonth(prev, -1))} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Previous month">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <p className="min-w-[150px] text-center text-sm font-semibold text-foreground">{monthLabel(month)}</p>
                <button type="button" onClick={() => setMonth((prev) => shiftMonth(prev, 1))} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Next month">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        {view === 'month' && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <SummaryTile label="Net due" value={rs(summary.due)} />
          <SummaryTile label="Paid this month" value={rs(summary.paid)} tone="primary" />
          <SummaryTile label="Remaining" value={rs(summary.remaining)} tone="warning" />
          <SummaryTile label="Advance given" value={rs(summary.advances)} />
          <SummaryTile label="Prior arrears" value={rs(summary.arrears)} tone={summary.arrears > 0 ? 'danger' : undefined} />
        </div>
        )}
        {view === 'history' && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            <SummaryTile label="All payments" value={String(historyRows.length)} />
            <SummaryTile label="Salary paid" value={rs(historyRows.filter((row) => row.type === 'salary').reduce((sum, row) => sum + Number(row.amount || 0), 0))} tone="primary" />
            <SummaryTile label="Advance paid" value={rs(historyRows.filter((row) => row.type === 'advance').reduce((sum, row) => sum + Number(row.amount || 0), 0))} />
          </div>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee..." className="w-full pl-9 pr-3 py-2.5 bg-card border border-border rounded-xl text-sm" />
      </div>

      {view === 'history' && historyEmployee && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2">
          <p className="text-sm text-foreground">Showing payments for <span className="font-semibold">{historyEmployee.name}</span></p>
          <button type="button" onClick={() => setHistoryEmployeeId(null)} className="text-xs font-semibold text-primary hover:underline">Show all staff</button>
        </div>
      )}

      {view === 'month' && (
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Original salary</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Deduction</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Received</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Bonus / Extra</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Late</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Advance</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">Loading payroll...</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">No payroll rows for {monthLabel(month)}</td></tr>
              )}
              {!loading && rows.map((row) => {
                const staff = staffName(row.employeeId, row);
                const { net, paid, remaining, extra, status } = rowMath(row);
                const advances = row.advanceDetails || [];
                const deduction = Number(row.deductions || 0);
                return (
                  <tr key={row.id} className={`border-b border-border/50 ${status === 'paid' ? 'bg-primary/5' : status === 'pending' ? 'bg-destructive/5' : 'bg-warning/5'}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{staff.name}</p>
                      {staff.role && <p className="text-xs text-muted-foreground">{staff.role}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-foreground">{rs(row.baseSalary)}</p>
                      <p className="text-[11px] text-muted-foreground">To pay {rs(net)}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">{deduction > 0 ? rs(deduction) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-foreground">{rs(paid)}</p>
                      {remaining > 0 && <p className="text-[11px] text-warning">{rs(remaining)} unpaid</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.bonus > 0 || extra > 0 ? (
                        <>
                          {row.bonus > 0 && <p className="text-foreground">Bonus {rs(row.bonus)}</p>}
                          {extra > 0 && <p className="text-[11px] text-primary">Extra {rs(extra)}</p>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">{row.lateFines > 0 ? rs(row.lateFines) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3">
                      {advances.length > 0 ? (
                        advances.map((item) => (
                          <p key={item.forMonth} className="text-foreground">
                            {monthLabel(item.forMonth)} {rs(item.amount)}
                          </p>
                        ))
                      ) : (row.advanceCredit || 0) > 0 ? (
                        <p className="text-primary">{rs(row.advanceCredit)} already credited here</p>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-xs px-2 py-1 rounded-full font-semibold ${statusClass[status]}`}>{receivedLabel(row)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => openPay(row)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/15" title="Enter payment amount">
                          <Wallet className="w-3.5 h-3.5" /> Pay
                        </button>
                        <button type="button" onClick={() => openHistory(row.employeeId)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-foreground text-[11px] font-semibold hover:bg-muted/80" title="Full history for this employee">
                          <History className="w-3.5 h-3.5" /> History
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {view === 'history' && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Paid on</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">For month</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Note</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading payment history...</td></tr>
                )}
                {!loading && historyRows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No payments recorded yet</td></tr>
                )}
                {!loading && historyRows.map((payment) => {
                  const staff = staffName(payment.employeeId, payment);
                  return (
                    <tr key={payment.id} className="border-b border-border/50">
                      <td className="px-4 py-3 text-foreground">{payment.paidOn}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{staff.name}</p>
                        {staff.role && <p className="text-xs text-muted-foreground">{staff.role}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${payment.type === 'advance' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'}`}>
                          {payment.type === 'advance' ? 'Advance' : 'Monthly salary'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{monthLabel(payment.forMonth)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{rs(payment.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{payment.note || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => openHistory(payment.employeeId)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-foreground text-[11px] font-semibold hover:bg-muted/80">
                          <History className="w-3.5 h-3.5" /> History
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payDialog && (
        <div className="fixed inset-0 bg-foreground/30 flex items-center justify-center z-50 p-4" onClick={() => { setPayDialog(null); setPayHistory(null); }}>
          <div className="bg-card rounded-2xl p-6 w-full max-w-3xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-lg font-bold text-foreground">Record payment — {payEmployeeName}</h3>
            <div className={`rounded-xl border px-3 py-2.5 ${selectedStatus === 'paid' ? 'border-primary/30 bg-primary/5' : selectedStatus === 'partial' ? 'border-warning/30 bg-warning/5' : 'border-destructive/30 bg-destructive/5'}`}>
              <p className={`text-sm font-semibold ${selectedStatus === 'paid' ? 'text-primary' : selectedStatus === 'partial' ? 'text-warning' : 'text-destructive'}`}>
                {selectedStatus === 'paid' && extraPaid > 0
                  ? `${payEmployeeName} has received ${monthLabel(payForMonth)} salary in full, plus extra ${rs(extraPaid)}`
                  : selectedStatus === 'paid'
                    ? `${payEmployeeName} has received ${monthLabel(payForMonth)} salary in full`
                    : selectedStatus === 'partial'
                      ? `${payEmployeeName} has received ${rs(alreadyPaid)} of ${monthLabel(payForMonth)} salary. ${rs(liveRemaining)} still unpaid.`
                      : `${payEmployeeName} has not received ${monthLabel(payForMonth)} salary`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Base {rs(liveBase)} + bonus {rs(liveBonus)} - deduction {rs(liveDeduction)} - late {rs(liveFine)} = net {rs(liveNet)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Already paid {rs(alreadyPaid)}
                {liveRemaining > 0 ? ` · still unpaid ${rs(liveRemaining)}` : ''}
                {extraPaid > 0 ? ` · extra on this month ${rs(extraPaid)}` : ''}
                {typedAmount > 0
                  ? afterExtra > 0
                    ? ` · after this pay: he receives ${rs(enteringAmount)}, extra ${rs(afterExtra)} stays on ${monthLabel(payForMonth)}`
                    : afterRemaining === 0
                      ? ` · after this pay: he receives ${rs(enteringAmount)} and ${monthLabel(payForMonth)} is marked paid`
                      : ` · after this pay: he receives ${rs(enteringAmount)}, remaining ${rs(afterRemaining)}`
                  : ''}
              </p>
            </div>
            {receivedMonths.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">Already received</p>
                <div className="flex flex-wrap gap-1">
                  {receivedMonths.map((row) => {
                    const isOpenMonth = row.month === payForMonth;
                    const paid = isOpenMonth ? alreadyPaid : Number(row.paidAmount || 0);
                    const net = isOpenMonth ? liveNet : Number(row.netSalary || 0);
                    const extra = Math.max(0, paid - net);
                    const status = paid <= 0 ? 'pending' : paid >= net && net > 0 ? 'paid' : 'partial';
                    return (
                      <span key={row.id} className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${status === 'paid' ? 'bg-primary/10 text-primary' : 'bg-warning/10 text-warning'}`}>
                        {monthLabel(row.month)} {status === 'paid'
                          ? (extra > 0 ? `full + extra ${rs(extra)}` : 'full')
                          : `partial ${rs(paid)}`}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {(payTarget?.arrears || 0) > 0 && (
              <p className="text-xs text-destructive">Unpaid from earlier months: {rs(payTarget?.arrears)}. Change the month below to clear arrears.</p>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Salary type</label>
              <select
                value={payType}
                onChange={(e) => changePayType(e.target.value as SalaryPaymentType)}
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1"
              >
                <option value="salary">Monthly salary</option>
                <option value="advance">Advance salary</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Amount he receives (Rs)</label>
              <input
                inputMode="numeric"
                autoFocus
                value={moneyDisplay(payAmount)}
                onChange={(e) => setPayAmount(digitsOnly(e.target.value))}
                placeholder="e.g. 11,500"
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">This is take-home after bonus, deduction and late fine. Base {rs(liveBase)} is not extra.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Base salary (Rs)</label>
                <input inputMode="numeric" value={moneyDisplay(payBase)} onChange={(e) => setPayBase(digitsOnly(e.target.value))} placeholder="0" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Bonus</label>
                <input inputMode="numeric" value={moneyDisplay(payBonus)} onChange={(e) => setPayBonus(digitsOnly(e.target.value))} placeholder="0" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Deduction</label>
                <input inputMode="numeric" value={moneyDisplay(payDeduction)} onChange={(e) => setPayDeduction(digitsOnly(e.target.value))} placeholder="0" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Late fine</label>
                <input inputMode="numeric" value={moneyDisplay(payLateFine)} onChange={(e) => setPayLateFine(digitsOnly(e.target.value))} placeholder="0" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Month</label>
                <select
                  value={splitMonthKey(payForMonth).month}
                  onChange={(e) => setPayForMonth(joinMonthKey(splitMonthKey(payForMonth).year, e.target.value))}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1"
                >
                  {MONTH_NAMES.map((name, index) => {
                    const value = String(index + 1).padStart(2, '0');
                    return <option key={value} value={value}>{name}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Year</label>
                <select
                  value={splitMonthKey(payForMonth).year}
                  onChange={(e) => setPayForMonth(joinMonthKey(e.target.value, splitMonthKey(payForMonth).month))}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1"
                >
                  {yearOptions(splitMonthKey(payForMonth).year).map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Note</label>
              <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Optional" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm mt-1" />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => { setPayDialog(null); setPayHistory(null); }} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button type="button" onClick={submitPayment} className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-secondary">Save</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: 'primary' | 'warning' | 'danger' }) {
  const valueClass = tone === 'primary' ? 'text-primary' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}
