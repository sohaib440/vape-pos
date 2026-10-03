// In BillPaymentPanel.tsx - FIXED VERSION

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Printer, Wallet, Banknote, CreditCard, Trash2, Repeat, Check, X as XIcon, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import type { Order, TableInfo } from '@/data/pos/mockData';
import { api } from '@/lib/api/api';
import { printReceipt, type ReceiptPaymentDetails } from '@/utils/pos/printReceipt';
import { usePosRealtimeScopes } from '@/hooks/pos/use-pos-realtime';
import { computePakistanTaxTotals } from '@/utils/pos/pakistanTax';
import { usePOSStore } from '@/stores/pos/posStore';
import { TablePicker } from '@/components/pos/TablePicker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface BillPaymentPanelProps {
  order: (Order & { dbId?: string; printed?: boolean }) | null;
  tableMap: Map<number, TableInfo>;
  taxRates: { gstRate: number; serviceChargeRate: number; takeawayChargeRate: number; minimumOrderAmount: number };
  currentUser: any;
  hasAction: (action: string) => boolean;
  discountLimit: number;
  onPaymentComplete: () => Promise<void>;
  markOrderAsPrinted: (id: string) => void;
  isOrderPrinted: (id: string) => boolean;
  runLocked: (key: string, fn: () => Promise<void>) => Promise<void>;
  isLocked: (key: string) => boolean;
  getStatusBadgeClass: (o: Order & { printed?: boolean }) => string;
  getBillStatusLabel: (o: Order & { printed?: boolean }) => string;
  formatOrderDateTime: (date: string) => string;
}

export const BillPaymentPanel: React.FC<BillPaymentPanelProps> = ({
  order,
  tableMap,
  taxRates,
  currentUser,
  hasAction,
  discountLimit,
  onPaymentComplete,
  markOrderAsPrinted,
  isOrderPrinted,
  runLocked,
  isLocked,
  getStatusBadgeClass,
  getBillStatusLabel,
  formatOrderDateTime,
}) => {
  const [discountMode, setDiscountMode] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'easypesa'>('cash');
  const [gstEnabled, setGstEnabled] = useState(true);
  const [takeawayChargeEnabled, setTakeawayChargeEnabled] = useState(true);
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [paidAmount, setPaidAmount] = useState<number | string>('');

  // Switch type UI state
  const [isSwitchingType, setIsSwitchingType] = useState(false);
  const [showSwitchTablePicker, setShowSwitchTablePicker] = useState(false);
  const [showDeliveryFields, setShowDeliveryFields] = useState(false);
  const [switchDeliveryName, setSwitchDeliveryName] = useState('');
  const [switchDeliveryPhone, setSwitchDeliveryPhone] = useState('');
  const [switchDeliveryAddress, setSwitchDeliveryAddress] = useState('');
  const [paymentDetails, setPaymentDetails] = useState<ReceiptPaymentDetails | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string; role: string }[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [isAssigningStaff, setIsAssigningStaff] = useState(false);

  const posStore = usePOSStore();

  const loadPaymentDetails = useCallback(() => {
    api<ReceiptPaymentDetails>('/settings/payment')
      .then(setPaymentDetails)
      .catch(() => setPaymentDetails(null));
  }, []);

  useEffect(() => {
    loadPaymentDetails();
  }, [loadPaymentDetails]);

  usePosRealtimeScopes(['settings'], loadPaymentDetails);

  // Fetch HR employees for staff assignment
  useEffect(() => {
    api<{ items: { id: string; name: string; role: string }[] }>('/hr/employees?limit=100')
      .then(r => setEmployees(r.items.filter(e => e.status !== 'inactive')))
      .catch(() => setEmployees([]));
  }, []);

  // Reset selected staff when order changes
  useEffect(() => {
    if (order) {
      setSelectedStaff(order.staffMember || '');
    }
  }, [order?.id]);

  const handleAssignStaff = async (employeeId: string) => {
    if (!order?.dbId) return;
    setIsAssigningStaff(true);
    try {
      await api(`/orders/${order.dbId}/assign-staff`, {
        method: 'PATCH',
        body: JSON.stringify({ staffMember: employeeId || null }),
      });
      setSelectedStaff(employeeId);
      toast.success(employeeId ? 'Staff member assigned' : 'Staff member removed');
      await onPaymentComplete();
    } catch (error) {
      toast.error('Failed to assign staff');
    } finally {
      setIsAssigningStaff(false);
    }
  };

  // Add a ref to track if we've already synced
  const lastSyncedValues = useRef<string>('');
  const syncTimeoutRef = useRef<NodeJS.Timeout>();

  // Reset local billing UI only when switching to a different bill.
  // Do NOT depend on order.discount / gst — sync + realtime refresh would
  // reset the inputs mid-edit and cause a mobile refresh/glitch loop.
  useEffect(() => {
    if (!order) return;
    setGstEnabled(order.gstEnabled !== false);
    const savedDiscount = Number(order.discount ?? 0);
    if (savedDiscount > 0) {
      setDiscountMode('amount');
      setDiscountValue(savedDiscount);
    } else {
      setDiscountMode('percent');
      setDiscountValue(0);
    }
    setPaidAmount('');
    setAdvanceAmount(Number(order.advanceAmount || 0));
    setTakeawayChargeEnabled(order.takeawayChargeEnabled !== false);
    setPaymentMethod('cash');
    setIsSwitchingType(false);
    setShowSwitchTablePicker(false);
    setShowDeliveryFields(false);
    setSwitchDeliveryName(order.customerName || '');
    setSwitchDeliveryPhone(order.phone || '');
    setSwitchDeliveryAddress(order.deliveryAddress || '');
    lastSyncedValues.current = '';
    setIsSyncing(false);
  }, [order?.id]);

  const subtotal = useMemo(() => {
    if (!order) return 0;
    return order.items.reduce((s, i: any) => s + (Number(i.menuItem.price) + Number(i.extraPrice || 0)) * i.quantity, 0);
  }, [order]);

  const discountAmt = useMemo(() => {
    if (discountMode === 'percent') {
      return subtotal * (discountValue / 100);
    }
    return Math.min(Math.max(discountValue, 0), subtotal);
  }, [subtotal, discountMode, discountValue]);

  const setDiscountWithLimit = (v: number) => {
    const val = Number(v) || 0;
    if (discountMode === 'percent' && val > discountLimit) {
      toast.error(`Discount is limited to ${discountLimit}% for this role`);
      setDiscountValue(discountLimit);
      return;
    }
    setDiscountValue(Math.max(0, val));
  };

  const taxTotals = useMemo(() => {
    return computePakistanTaxTotals(
      subtotal,
      discountAmt,
      gstEnabled,
      taxRates,
      {
        applyServiceCharge: order?.type === 'dine-in',
        applyTakeawayCharge: order?.type === 'takeaway' && takeawayChargeEnabled
      }
    );
  }, [subtotal, discountAmt, gstEnabled, taxRates, order?.type, takeawayChargeEnabled]);

  const { gstAmount, totalTaxAmount, grandTotal, taxableAmount, serviceCharge = 0, takeawayCharge = 0 } = taxTotals;
  const balancePayable = Math.max(0, grandTotal - advanceAmount);

  // Create a stable string of current values to compare
  const currentSyncValues = useMemo(() => {
    return JSON.stringify({
      subtotal,
      discountAmt,
      gstEnabled,
      grandTotal,
      totalTaxAmount,
      gstAmount,
      serviceCharge,
      takeawayCharge,
      advanceAmount,
      takeawayChargeEnabled,
    });
  }, [subtotal, discountAmt, gstEnabled, grandTotal, totalTaxAmount, gstAmount, serviceCharge, takeawayCharge, advanceAmount, takeawayChargeEnabled]);

  // Sync billing totals with backend - ONLY when values actually change
  useEffect(() => {
    if (!order?.dbId || order.status === 'completed') return;

    if (lastSyncedValues.current === currentSyncValues) return;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      lastSyncedValues.current = currentSyncValues;
      setIsSyncing(true);

      api(`/orders/${order.dbId}/billing-totals`, {
        method: 'PATCH',
        body: JSON.stringify({
          gstEnabled,
          total: grandTotal,
          subtotal,
          discount: discountAmt,
          tax: totalTaxAmount,
          gstAmount,
          serviceCharge,
          takeawayCharge,
          advanceAmount,
          takeawayChargeEnabled,
        }),
      })
        .catch((err) => {
          console.error('Failed to sync billing totals:', err);
          // Keep lastSyncedValues so we don't hammer retries on every keystroke
        })
        .finally(() => {
          setIsSyncing(false);
        });
    }, 500);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [order?.dbId, order?.status, currentSyncValues]);

  const fmt = (v: number) => `Rs. ${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const buildReceiptData = (
    targetOrder: Order & { dbId?: string; printed?: boolean },
    paidStamp: boolean,
    overridePaymentMethod?: string
  ) => {
    const isCurrentOrder = targetOrder.id === order?.id;
    const orderSubtotal = targetOrder.items.reduce((s, i: any) => s + (Number(i.menuItem.price) + Number(i.extraPrice || 0)) * i.quantity, 0);

    // For the current order we use the UI's discount/gst state
    const orderDiscount = isCurrentOrder ? discountAmt : Number(targetOrder.discount || 0);
    const orderGst = isCurrentOrder ? gstEnabled : targetOrder.gstEnabled !== false;

    const breakdown = computePakistanTaxTotals(
      orderSubtotal,
      orderDiscount,
      orderGst,
      taxRates,
      {
        applyServiceCharge: targetOrder.type === 'dine-in',
        applyTakeawayCharge: targetOrder.type === 'takeaway' && (targetOrder as any).takeawayChargeEnabled !== false
      }
    );

    const orderGrandTotal = targetOrder.status === 'completed' && Number.isFinite(Number(targetOrder.total))
      ? Number(targetOrder.total)
      : breakdown.grandTotal;

    const orderAdvance = isCurrentOrder ? advanceAmount : Number(targetOrder.advanceAmount || 0);
    const orderRemaining = Math.max(0, orderGrandTotal - orderAdvance);

    const paymentLabel = paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Card' : 'EasyPaisa';
    const tableInfo = targetOrder.table ? tableMap.get(Number(targetOrder.table)) : null;

    return {
      orderId: targetOrder.id,
      orderType: targetOrder.type,
      table: targetOrder.table,
      tableName: tableInfo?.name,
      items: targetOrder.items,
      subtotal: orderSubtotal,
      discount: orderDiscount,
      discountPercent: 0,
      gstEnabled: orderGst,
      gstRate: taxRates.gstRate,
      serviceChargeRate: taxRates.serviceChargeRate,
      takeawayChargeRate: taxRates.takeawayChargeRate,
      minimumOrderAmount: taxRates.minimumOrderAmount,
      takeawayChargeEnabled: isCurrentOrder ? takeawayChargeEnabled : targetOrder.takeawayChargeEnabled !== false,
      paymentMethod: targetOrder.status === 'completed'
        ? String(overridePaymentMethod || (targetOrder as any).paymentMethod || paymentLabel)
        : paymentLabel,
      grandTotal: orderGrandTotal,
      advanceAmount: orderAdvance,
      remainingAmount: orderRemaining,
      paidStamp,
      user: currentUser?.name || 'Cashier',
      timestamp: new Date().toISOString(),
      gstAmount: breakdown.gstAmount,
      serviceCharge: breakdown.serviceCharge,
      takeawayCharge: breakdown.takeawayCharge,
      fbrInvoiceNumber: '',
      customerName: targetOrder.customerName,
      customerPhone: targetOrder.type === 'delivery' ? targetOrder.phone : undefined,
      deliveryAddress: targetOrder.type === 'delivery' ? targetOrder.deliveryAddress : undefined,
      paymentDetails: paymentDetails || undefined,
      orderCreatedAt: targetOrder.createdAt,
      amountPaid: targetOrder.status === 'completed'
        ? (targetOrder as any).amountPaid || orderRemaining
        : paymentMethod === 'cash'
          ? (Number(paidAmount) >= orderRemaining ? Number(paidAmount) : orderRemaining)
          : orderRemaining,
      changeDue: targetOrder.status === 'completed'
        ? (targetOrder as any).changeDue || 0
        : paymentMethod === 'cash'
          ? (Number(paidAmount) >= orderRemaining ? Number(paidAmount) - orderRemaining : 0)
          : 0,
      isPaid: paidStamp || targetOrder.status === 'completed',
      cashierName: (targetOrder as any).cashierName || currentUser?.name || currentUser?.email,
    };
  };

  const handlePrint = async () => {
    if (!order) return;

    // 1. Print locally immediately for speed
    const data = buildReceiptData(order, false);
    printReceipt(data);
    markOrderAsPrinted(order.id);
    toast.success('Receipt sent to printer!');

    // 2. Update status in DB if it's currently pending or preparing
    // This ensures other terminals see it as "Ready"
    if (order.dbId && (order.status === 'pending' || order.status === 'preparing')) {
      try {
        await api(`/orders/${order.dbId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ready' }),
        });
        // onPaymentComplete usually refreshes the list
        await onPaymentComplete();
      } catch (err) {
        console.error('Failed to update order status to ready:', err);
      }
    }
  };

  const handleVoidOrder = () => {
    if (!order?.dbId) return;
    if (!window.confirm('Are you sure you want to permanently delete this bill? This cannot be undone.')) return;

    void runLocked('void-order', async () => {
      await api(`/orders/${order.dbId}`, { method: 'DELETE' });
      toast.success('Bill deleted successfully');
      await onPaymentComplete();
    }).catch(err => toast.error(err instanceof Error ? err.message : 'Failed to delete bill'));
  };

  const handleCompletePayment = () => {
    if (!order) return;
    void runLocked('complete-payment', async () => {
      if (order.status === 'completed') {
        const data = buildReceiptData(order, true, (order as any).paymentMethod);
        printReceipt(data);
        markOrderAsPrinted(order.id);
        toast.success('Paid bill reprinted');
        return;
      }

      if (order.dbId) {
        const remaining = Math.max(0, grandTotal - advanceAmount);
        const amountPaidNum = paymentMethod === 'cash'
          ? (Number(paidAmount) >= remaining ? Number(paidAmount) : remaining)
          : remaining;
        const changeDueNum = paymentMethod === 'cash'
          ? (Number(paidAmount) >= remaining ? Number(paidAmount) - remaining : 0)
          : 0;

        await api(`/orders/${order.dbId}/payment`, {
          method: 'POST',
          body: JSON.stringify({
            paymentMethod,
            gstEnabled,
            total: grandTotal,
            subtotal,
            discount: discountAmt,
            tax: totalTaxAmount,
            gstAmount,
            serviceCharge,
            takeawayCharge,
            advanceAmount,
            amountPaid: amountPaidNum,
            changeDue: changeDueNum,
          }),
        });

        const data = buildReceiptData({
          ...order,
          status: 'completed',
          amountPaid: amountPaidNum,
          changeDue: changeDueNum
        } as any, true, paymentMethod);

        printReceipt(data);
        markOrderAsPrinted(order.id);
        toast.success('Payment completed and receipt printed');
        await onPaymentComplete();
      } else {
        toast.success('Payment processed!');
      }
    }).catch(err => toast.error(err instanceof Error ? err.message : 'Payment failed'));
  };

  const performSwitchType = async (
    newType: 'dine-in' | 'takeaway' | 'delivery',
    tableName?: string,
    deliveryFields?: { customerName: string; phone: string; deliveryAddress: string },
    tableId?: string
  ) => {
    if (!order?.dbId) return;

    await runLocked('switch-type', async () => {
      await api(`/orders/${order.dbId}/switch-type`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: newType,
          table: tableName,
          tableId,
          customerName: deliveryFields?.customerName,
          phone: deliveryFields?.phone,
          deliveryAddress: deliveryFields?.deliveryAddress,
        }),
      });
      toast.success(`Order switched to ${newType}`);
      setIsSwitchingType(false);
      setShowSwitchTablePicker(false);
      setShowDeliveryFields(false);
      await onPaymentComplete();
    }).catch(err => {
      toast.error(err instanceof Error ? err.message : 'Failed to switch type');
    });
  };

  const handleSwitchTypeClick = (target: 'dine-in' | 'takeaway' | 'delivery') => {
    if (target === 'dine-in') {
      setShowSwitchTablePicker(true);
    } else if (target === 'delivery') {
      setSwitchDeliveryName(order?.customerName || '');
      setSwitchDeliveryPhone(order?.phone || '');
      setSwitchDeliveryAddress(order?.deliveryAddress || '');
      setShowDeliveryFields(true);
    } else {
      void performSwitchType(target);
    }
  };

  const handleConfirmDeliverySwitch = () => {
    if (!switchDeliveryName.trim() || !switchDeliveryPhone.trim() || !switchDeliveryAddress.trim()) {
      toast.error('Enter customer name, phone, and address for delivery');
      return;
    }
    void performSwitchType('delivery', undefined, {
      customerName: switchDeliveryName.trim(),
      phone: switchDeliveryPhone.trim(),
      deliveryAddress: switchDeliveryAddress.trim(),
    });
  };

  if (!order) {
    return (
      <div className="pos-card flex flex-col items-center justify-center p-6 sm:p-8 border-dashed">
        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-muted flex items-center justify-center mb-3 sm:mb-4">
          <Wallet className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground/30" />
        </div>
        <h3 className="text-base sm:text-lg font-serif font-bold text-foreground">No Bill Selected</h3>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-[260px] text-center mt-1 leading-relaxed">
          Click on a bill from the orders list to view details and process payment.
        </p>
      </div>
    );
  }

  return (
    <div className="pos-card !p-3 sm:!p-4 flex min-h-0 flex-1 flex-col overflow-hidden shadow-sm relative print:overflow-visible bg-card border border-border">
      <AnimatePresence mode="wait">
        <motion.div
          key={order.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="flex flex-col flex-1 min-h-0"
        >
          {/* Paid Watermark - Print only */}
          {order.status === 'completed' && (
            <div className="hidden print:flex print:absolute print:inset-0 print:items-center print:justify-center print:pointer-events-none print:z-10 print:overflow-visible">
              <div className="transform -rotate-45">
                <p className="font-black tracking-wider" style={{ fontSize: '180px', lineHeight: '1', color: '#ef4444', opacity: 0.3, textShadow: '2px 2px 4px rgba(0,0,0,0.2)' }}>PAID</p>
              </div>
            </div>
          )}

          <div className="absolute top-3 right-3 z-10">
            <AnimatePresence>
              {isSyncing && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-[9px] font-black text-primary uppercase tracking-widest shadow-sm"
                >
                  <Repeat className="w-2.5 h-2.5 animate-spin" />
                  Saving...
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mb-3 sm:mb-5 shrink-0 border-b border-border pb-3 sm:pb-4 space-y-2">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="font-black text-lg sm:text-xl text-foreground truncate">{order.id}</h2>
                  {order.status !== 'completed' && (
                    <button
                      onClick={() => setIsSwitchingType(!isSwitchingType)}
                      className={`p-1.5 rounded-lg border transition-all shrink-0 ${isSwitchingType ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}
                      title="Switch Order Type"
                    >
                      <Repeat className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 font-medium break-words">
                  {formatOrderDateTime(order.createdAt)} • <span className="capitalize">{order.type}</span>
                </p>
              </div>
              {order.table && (
                <div className="flex gap-1.5 items-center shrink-0">
                  <span className="text-[10px] font-black text-muted-foreground uppercase">
                    {tableMap.get(Number(order.table))?.floorId || 'Floor'}
                  </span>
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-md font-black text-xs sm:text-sm">
                    {tableMap.get(Number(order.table))?.name || order.table}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-block text-[10px] uppercase font-black px-2.5 py-0.5 rounded-full border ${getStatusBadgeClass(order)}`}>
                {getBillStatusLabel(order)}
              </span>
              {order.orderTaker && (
                <p className="text-[10px] uppercase font-bold text-muted-foreground">
                  Taken by <span className="text-foreground">{order.orderTaker}</span>
                </p>
              )}
            </div>
          </div>

          {/* Staff Assignment Section */}
          <div className="mb-3 sm:mb-4 shrink-0 rounded-xl border border-border/70 p-2.5 sm:p-3 bg-muted/20">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <div className="flex items-center gap-2 shrink-0">
                <UserCheck className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-muted-foreground">Assign to Staff</span>
              </div>
              <Select
                value={selectedStaff || 'none'}
                onValueChange={(v) => handleAssignStaff(v === 'none' ? '' : v)}
                disabled={isAssigningStaff}
              >
                <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs font-semibold bg-background">
                  <SelectValue placeholder="None (Customer)" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-xl max-h-[200px] overflow-y-auto">
                  <SelectItem value="none" className="text-xs font-medium">None (Customer)</SelectItem>
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id} className="text-xs font-medium">
                      {emp.name} ({emp.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedStaff && (
              <p className="text-[10px] text-primary font-bold mt-2">
                Bill assigned to: {employees.find(e => e.id === selectedStaff)?.name}
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">

            {/* Switch Type UI */}
            {isSwitchingType && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 mb-4 space-y-3 animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase font-black text-primary tracking-widest">Switch Order Type</p>
                  <button onClick={() => setIsSwitchingType(false)}><XIcon className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" /></button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    disabled={order.type === 'dine-in'}
                    onClick={() => handleSwitchTypeClick('dine-in')}
                    className="py-2 rounded-lg bg-card border border-border text-[10px] font-black uppercase hover:border-primary transition-all disabled:opacity-30"
                  >
                    Dine-in
                  </button>
                  <button
                    disabled={order.type === 'takeaway'}
                    onClick={() => handleSwitchTypeClick('takeaway')}
                    className="py-2 rounded-lg bg-card border border-border text-[10px] font-black uppercase hover:border-primary transition-all disabled:opacity-30"
                  >
                    Takeaway
                  </button>
                  <button
                    disabled={order.type === 'delivery'}
                    onClick={() => handleSwitchTypeClick('delivery')}
                    className="py-2 rounded-lg bg-card border border-border text-[10px] font-black uppercase hover:border-primary transition-all disabled:opacity-30"
                  >
                    Delivery
                  </button>
                </div>
                {order.type === 'dine-in' && (
                  <p className="text-[10px] text-muted-foreground text-center italic">Switching from Dine-in will free table {order.table} and remove service charges.</p>
                )}
                {['takeaway', 'delivery'].includes(order.type) && (
                  <p className="text-[10px] text-muted-foreground text-center italic">Switching to Dine-in will apply service charges.</p>
                )}
                {showDeliveryFields && (
                  <div className="space-y-2 pt-2 border-t border-primary/20">
                    <input
                      value={switchDeliveryName}
                      onChange={(e) => setSwitchDeliveryName(e.target.value)}
                      placeholder="Customer name"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                    />
                    <input
                      value={switchDeliveryPhone}
                      onChange={(e) => setSwitchDeliveryPhone(e.target.value)}
                      placeholder="Phone number"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                    />
                    <textarea
                      value={switchDeliveryAddress}
                      onChange={(e) => setSwitchDeliveryAddress(e.target.value)}
                      placeholder="Delivery address"
                      rows={3}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm resize-none"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmDeliverySwitch}
                      className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest"
                    >
                      Confirm delivery switch
                    </button>
                  </div>
                )}
              </div>
            )}

            {order.type === 'delivery' && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2 mb-4">
                <h3 className="text-xs font-semibold tracking-wide text-primary uppercase">Delivery customer</h3>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium text-foreground text-right">{order.customerName || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="font-medium text-foreground text-right">{order.phone || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Address</span>
                    <span className="font-medium text-foreground text-right max-w-[65%] whitespace-pre-wrap">{order.deliveryAddress || '—'}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border/70 bg-muted/35 p-2.5 sm:p-3 space-y-2 mb-3 sm:mb-4">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">ORDER ITEMS</h3>
              {order.items.map((item: any, i) => (
                <div key={i} className="flex justify-between gap-3 text-sm py-1 border-b border-border/40 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground break-words">{item.quantity}× {item.menuItem.name}</p>
                    {item.extraName && (
                      <p className="text-[11px] text-primary font-bold">
                        + {item.extraName} (Rs. {Number(item.extraPrice || 0).toLocaleString()})
                      </p>
                    )}
                  </div>
                  <span className="font-medium text-foreground shrink-0 tabular-nums">
                    Rs. {((Number(item.menuItem.price) + Number(item.extraPrice || 0)) * item.quantity).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 space-y-3 mb-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  <span>Subtotal</span>
                  <span>{fmt(subtotal)}</span>
                </div>

                {discountAmt > 0 && (
                  <div className="flex justify-between text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
                    <span>Discount {discountMode === 'percent' ? `(${discountValue}%)` : ''}</span>
                    <span>-{fmt(discountAmt)}</span>
                  </div>
                )}

                <div className="flex justify-between text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-1.5">
                  <span>Taxable Amount</span>
                  <span>{fmt(taxableAmount)}</span>
                </div>

                <div className="space-y-1 mt-1">
                  {order.type === 'dine-in' && (
                    <div className="flex justify-between text-[10px] text-muted-foreground/70 font-medium">
                      <span>Service Charge ({Math.round(taxRates.serviceChargeRate * 100)}%)</span>
                      <span>{fmt(serviceCharge)}</span>
                    </div>
                  )}
                  {order.type === 'takeaway' && takeawayCharge > 0 && (
                    <div className="flex justify-between text-[10px] text-muted-foreground/70 font-medium">
                      <span>Takeaway Charge ({Math.round(taxRates.takeawayChargeRate * 100)}%)</span>
                      <span>{fmt(takeawayCharge)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px] text-muted-foreground/70 font-medium">
                    <span>GST ({gstEnabled ? Math.round(taxRates.gstRate * 100) : 0}%)</span>
                    <span>{fmt(gstAmount)}</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-border flex flex-col gap-1">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Total Bill</span>
                  <span className="text-2xl font-black text-foreground tracking-tighter leading-none">{fmt(grandTotal)}</span>
                </div>

                {advanceAmount > 0 && (
                  <>
                    <div className="flex justify-between items-center text-[11px] font-bold text-primary uppercase tracking-wider mt-1">
                      <span>Advance Received</span>
                      <span>-{fmt(advanceAmount)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 mt-1 border-t border-dashed border-border/50">
                      <span className="text-[11px] font-black text-foreground uppercase tracking-widest">Balance Payable</span>
                      <span className="text-lg font-black text-primary tracking-tight">{fmt(balancePayable)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Payment Details for Completed Bills */}
            {order.status === 'completed' && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-in fade-in slide-in-from-top-1 mb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-emerald-600 mb-1.5 block tracking-wider">Amount Paid</label>
                    <div className="text-lg font-black text-foreground">
                      {fmt(order.amountPaid || order.total)}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 block tracking-wider">Change Returned</label>
                    <div className={`text-lg font-black ${Number(order.changeDue) > 0 ? 'text-emerald-600' : 'text-muted-foreground/40'}`}>
                      {fmt(order.changeDue || 0)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-emerald-500/10 flex justify-between items-center">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Payment Method</span>
                  <span className="text-[10px] uppercase font-black text-foreground capitalize">{(order as any).paymentMethod || 'Cash'}</span>
                </div>
              </div>
            )}

            {/* Discount / Tax toggles - only for pending bills */}
            {order.status !== 'completed' && (
              <div className="space-y-4">
                {hasAction('apply_discount') && (
                  <div className="rounded-xl border border-border/70 p-3 bg-muted/20">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
                      <div className="text-xs font-semibold text-muted-foreground">Discount</div>
                      <div className="inline-flex rounded-full bg-card p-1 shadow-sm">
                        <button
                          type="button"
                          onClick={() => {
                            setDiscountMode('percent');
                            setDiscountValue(0);
                          }}
                          className={`px-3 py-1.5 text-[10px] uppercase font-bold tracking-wider rounded-lg transition-all ${discountMode === 'percent' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          Percent
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDiscountMode('amount');
                            setDiscountValue(0);
                          }}
                          className={`px-3 py-1.5 text-[10px] uppercase font-bold tracking-wider rounded-lg transition-all ${discountMode === 'amount' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          Amount
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="number"
                        min="0"
                        value={discountValue}
                        onChange={(e) => setDiscountWithLimit(Number(e.target.value))}
                        className="w-full sm:w-32 bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      {discountMode === 'percent' && (
                        <div className="flex gap-2 flex-wrap">
                          {[0, 5, 10, 15, 20].filter(d => discountLimit >= 100 || d <= Math.max(discountLimit, 0)).map(d => (
                            <button key={d} type="button" onClick={() => setDiscountWithLimit(d)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${discountValue === d ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card border border-border text-muted-foreground hover:border-primary/30'}`}>
                              {d}%
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {discountLimit < 100 && (
                      <p className="text-[10px] text-muted-foreground/60 mt-2">This role can give up to {discountLimit}% discount.</p>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-border/70 p-3 bg-muted/20">
                  <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={gstEnabled}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setGstEnabled(val);
                        localStorage.setItem('pos_gst_enabled', val.toString());
                      }}
                      className="w-4 h-4 text-primary border-border rounded focus:ring-primary/30"
                    />
                    Include GST Summary ({Math.round(taxRates.gstRate * 100)}%)
                  </label>
                </div>

                {order.type === 'takeaway' && (
                  <div className="rounded-xl border border-border/70 p-3 bg-muted/20">
                    <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={takeawayChargeEnabled}
                        onChange={(e) => setTakeawayChargeEnabled(e.target.checked)}
                        className="w-4 h-4 text-primary border-border rounded focus:ring-primary/30"
                      />
                      Include Takeaway Charge ({Math.round(taxRates.takeawayChargeRate * 100)}%)
                    </label>
                  </div>
                )}

                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 sm:p-4 animate-in fade-in slide-in-from-top-1">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <label className="text-[10px] uppercase font-bold text-primary mb-1 block tracking-[0.15em]">Advance Received (PKR)</label>
                      <p className="text-[10px] text-muted-foreground/60 italic leading-snug">Amount received before final billing</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={advanceAmount || ''}
                      onChange={(e) => setAdvanceAmount(Number(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full sm:w-32 bg-background border border-primary/20 rounded-xl px-3 py-2.5 text-sm font-black focus:ring-4 focus:ring-primary/10 outline-none transition-all text-right placeholder:text-muted-foreground/20"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-border/70 p-2.5 sm:p-3 bg-muted/20">
                  <label className="text-xs font-semibold text-muted-foreground mb-2 sm:mb-3 block">Payment Method</label>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('cash')}
                      className={`inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 rounded-xl border px-1.5 sm:px-3 py-2.5 sm:py-3 text-[10px] sm:text-xs font-bold transition-all ${paymentMethod === 'cash'
                        ? 'bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]'
                        : 'bg-card text-muted-foreground border-border hover:border-primary/30 hover:bg-primary/5'
                        }`}
                    >
                      <Banknote className="w-4 h-4 shrink-0" />
                      <span>Cash</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('card')}
                      className={`inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 rounded-xl border px-1.5 sm:px-3 py-2.5 sm:py-3 text-[10px] sm:text-xs font-bold transition-all ${paymentMethod === 'card'
                        ? 'bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]'
                        : 'bg-card text-muted-foreground border-border hover:border-primary/30 hover:bg-primary/5'
                        }`}
                    >
                      <CreditCard className="w-4 h-4 shrink-0" />
                      <span>Card</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('easypesa')}
                      className={`inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 rounded-xl border px-1.5 sm:px-3 py-2.5 sm:py-3 text-[10px] sm:text-xs font-bold transition-all ${paymentMethod === 'easypesa'
                        ? 'bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]'
                        : 'bg-card text-muted-foreground border-border hover:border-primary/30 hover:bg-primary/5'
                        }`}
                    >
                      <Wallet className="w-4 h-4 shrink-0" />
                      <span>e-Wallet</span>
                    </button>
                  </div>
                </div>

                {paymentMethod === 'cash' && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 sm:p-4 animate-in fade-in slide-in-from-top-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      <div>
                        <label className="text-[10px] uppercase font-bold text-primary mb-1.5 block tracking-wider">Amount Received</label>
                        <input
                          type="number"
                          value={paidAmount}
                          onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="0.00"
                          className="w-full bg-background border border-primary/30 rounded-xl px-3 py-3 text-lg font-black focus:ring-4 focus:ring-primary/15 outline-none transition-all placeholder:text-muted-foreground/30"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 block tracking-wider">Change Due</label>
                        <div className={`w-full bg-card border border-border rounded-xl px-3 py-3 text-lg font-black flex items-center transition-all ${Number(paidAmount) >= balancePayable ? 'text-success shadow-sm' : 'text-muted-foreground/40'}`}>
                          {Number(paidAmount) >= balancePayable ? fmt(Number(paidAmount) - balancePayable) : 'Rs. 0'}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-4 flex-wrap">
                      {[500, 1000, 5000].map(amt => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setPaidAmount((Number(paidAmount) || 0) + amt)}
                          className="px-3 py-1.5 rounded-lg bg-card border border-border text-[11px] font-black text-foreground hover:border-primary hover:text-primary transition-all shadow-sm active:scale-95"
                        >
                          + {amt.toLocaleString()}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setPaidAmount(Math.ceil(balancePayable / 500) * 500)}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-[11px] font-black text-primary hover:bg-primary hover:text-white transition-all shadow-sm ml-auto"
                      >
                        Round Up
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 sm:mt-6 flex flex-col gap-2 shrink-0 border-t border-border pt-3 sm:pt-5">
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <div className="grid grid-cols-2 sm:contents gap-2">
                {hasAction('delete_order') && order.status !== 'completed' && (
                  <button
                    onClick={handleVoidOrder}
                    disabled={isLocked('void-order')}
                    className="py-3 sm:py-3.5 rounded-2xl bg-destructive/10 text-destructive text-[10px] sm:text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 sm:gap-2 hover:bg-destructive hover:text-white transition-all active:scale-[0.98] sm:flex-1"
                  >
                    <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="truncate">Delete</span>
                  </button>
                )}

                <button
                  onClick={handlePrint}
                  className={`py-3 sm:py-3.5 rounded-2xl bg-muted text-muted-foreground text-[10px] sm:text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 sm:gap-2 hover:bg-muted/80 transition-all active:scale-[0.98] sm:flex-1 ${!(hasAction('delete_order') && order.status !== 'completed') ? 'col-span-2' : ''}`}
                >
                  <Printer className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span className="truncate">Print</span>
                </button>
              </div>
              <button
                onClick={handleCompletePayment}
                disabled={isLocked('complete-payment')}
                className="w-full sm:flex-[2] py-3 sm:py-3.5 rounded-2xl bg-primary text-primary-foreground text-[10px] sm:text-xs font-bold uppercase tracking-wider hover:bg-secondary transition-all shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {order.status === 'completed' ? 'Reprint Paid' : 'Complete Payment'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Switch Type Table Picker */}
      {showSwitchTablePicker && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-4xl bg-card rounded-2xl border border-border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-border shrink-0 bg-muted/20">
              <div>
                <h2 className="text-sm font-black text-foreground uppercase tracking-widest">Select Dine-in Table</h2>
                <p className="text-[10px] text-muted-foreground font-bold mt-0.5">FOR SWITCHING ORDER {order.id}</p>
              </div>
              <button
                onClick={() => setShowSwitchTablePicker(false)}
                className="p-2 hover:bg-muted rounded-full transition-colors"
              >
                <XIcon className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <TablePicker
                floors={posStore.floors}
                tables={posStore.tables}
                selectedTableId={null}
                onTableSelect={(id) => {
                  const t = posStore.tables.find(x => x.id === id);
                  if (t) void performSwitchType('dine-in', t.name, undefined, t.mongoId);
                }}
                activeFloorId={posStore.activeFloorId}
                setActiveFloorId={posStore.setActiveFloorId}
              />
            </div>

            <div className="p-4 bg-muted/30 border-t border-border flex justify-end shrink-0 gap-3">
              <button
                onClick={() => setShowSwitchTablePicker(false)}
                className="px-6 py-2.5 bg-card border border-border text-foreground rounded-xl hover:bg-muted transition-all text-[10px] font-black uppercase tracking-widest"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
