import type { Order, TableInfo } from '@/data/pos/mockData';

const item = (name: string, price: number, quantity = 1) => ({
  menuItem: {
    id: `mi-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    price,
    category: 'BBQ',
    image: '',
    description: '',
    available: true,
    perishable: false,
  },
  quantity,
  notes: '',
});

/** Demo tables used when real tables are empty (floor filter testing). */
export const DUMMY_BILL_TABLES: TableInfo[] = [
  { id: 11, mongoId: 'dummy-t11', number: 11, name: 'MH-11', seats: 4, floorId: 'MH', status: 'occupied' },
  { id: 22, mongoId: 'dummy-t22', number: 22, name: 'RT-05', seats: 6, floorId: 'RT', status: 'occupied' },
  { id: 33, mongoId: 'dummy-t33', number: 33, name: 'BT-02', seats: 2, floorId: 'BT', status: 'available' },
  { id: 44, mongoId: 'dummy-t44', number: 44, name: 'ET-08', seats: 8, floorId: 'ET', status: 'occupied' },
];

export const DUMMY_BILL_FLOORS = [
  { key: 'MH', name: 'MH' },
  { key: 'RT', name: 'RT' },
  { key: 'BT', name: 'BT' },
  { key: 'ET', name: 'ET' },
];

export const DUMMY_BILL_CASHIERS = [
  { key: 'Ali Cashier', name: 'Ali Cashier' },
  { key: 'Sara Admin', name: 'Sara Admin' },
  { key: 'Super Admin', name: 'Super Admin' },
];

function atHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Varied demo bills so status / type / floor / cashier filters can be exercised. */
export function getDummyBills(currentUserName?: string): (Order & { dbId: string; printed?: boolean })[] {
  const taker = currentUserName || 'Super Admin';

  return [
    {
      id: 'ORD-900001',
      dbId: 'dummy-900001',
      items: [item('Chicken Karahi', 1800), item('Naan', 50, 4)],
      type: 'dine-in',
      status: 'pending',
      table: 11,
      total: 0,
      tax: 0,
      subtotal: 2000,
      discount: 0,
      notes: '',
      createdAt: atHoursAgo(1),
      orderTaker: taker,
      gstEnabled: true,
    },
    {
      id: 'ORD-900002',
      dbId: 'dummy-900002',
      items: [item('Mutton BBQ Platter', 3500)],
      type: 'dine-in',
      status: 'ready',
      table: 22,
      total: 0,
      tax: 0,
      subtotal: 3500,
      discount: 0,
      notes: '',
      createdAt: atHoursAgo(2),
      orderTaker: 'Ali Cashier',
      gstEnabled: true,
      printed: true,
    },
    {
      id: 'ORD-900003',
      dbId: 'dummy-900003',
      items: [item('Beef Shinwari', 2200), item('Raita', 150)],
      type: 'takeaway',
      status: 'preparing',
      total: 0,
      tax: 0,
      subtotal: 2350,
      discount: 0,
      notes: '',
      createdAt: atHoursAgo(3),
      orderTaker: 'Sara Admin',
      gstEnabled: true,
      takeawayChargeEnabled: true,
    },
    {
      id: 'ORD-900004',
      dbId: 'dummy-900004',
      items: [item('Chicken Malai Boti', 1200, 2)],
      type: 'delivery',
      status: 'served',
      total: 0,
      tax: 0,
      subtotal: 2400,
      discount: 0,
      notes: '',
      createdAt: atHoursAgo(4),
      orderTaker: taker,
      customerName: 'Ahmed Khan',
      phone: '0300-1234567',
      deliveryAddress: 'House 12, Street 4, Islamabad',
      gstEnabled: true,
      printed: true,
    },
    {
      id: 'ORD-900005',
      dbId: 'dummy-900005',
      items: [item('Kabli Pulao', 900), item('Chapli Kebab', 400, 2)],
      type: 'dine-in',
      status: 'completed',
      table: 33,
      total: 1980,
      tax: 280,
      subtotal: 1700,
      discount: 0,
      notes: '',
      createdAt: atHoursAgo(5),
      orderTaker: 'Ali Cashier',
      gstEnabled: true,
      amountPaid: 2000,
      changeDue: 20,
      paymentMethod: 'cash',
      cashierName: 'Ali Cashier',
    },
    {
      id: 'ORD-900006',
      dbId: 'dummy-900006',
      items: [item('Family BBQ Deal', 5500)],
      type: 'dine-in',
      status: 'completed',
      table: 44,
      total: 6380,
      tax: 880,
      subtotal: 5500,
      discount: 0,
      notes: '',
      createdAt: atHoursAgo(8),
      orderTaker: 'Sara Admin',
      gstEnabled: true,
      amountPaid: 6380,
      changeDue: 0,
      paymentMethod: 'card',
      cashierName: 'Sara Admin',
    },
    {
      id: 'ORD-900007',
      dbId: 'dummy-900007',
      items: [item('Seekh Kebab', 650, 3)],
      type: 'takeaway',
      status: 'taken away',
      total: 0,
      tax: 0,
      subtotal: 1950,
      discount: 100,
      notes: '',
      createdAt: atHoursAgo(10),
      orderTaker: taker,
      gstEnabled: true,
      takeawayChargeEnabled: true,
      printed: true,
    },
    {
      id: 'ORD-900008',
      dbId: 'dummy-900008',
      items: [item('Mutton Karahi', 2800), item('Salad', 200)],
      type: 'dine-in',
      status: 'pending',
      table: 22,
      total: 0,
      tax: 0,
      subtotal: 3000,
      discount: 0,
      notes: '',
      createdAt: atHoursAgo(0.5),
      orderTaker: 'Ali Cashier',
      gstEnabled: true,
    },
  ];
}

export function filterDummyBills(
  bills: (Order & { dbId: string; printed?: boolean })[],
  opts: {
    startDate: string;
    endDate: string;
    selectedFloor: string;
    selectedOrderType: string;
    selectedCashier: string;
    showMyBillsOnly: boolean;
    currentUserName?: string;
    search: string;
    tableMap: Map<number, TableInfo>;
  },
) {
  const start = new Date(`${opts.startDate}T00:00:00`);
  const end = new Date(`${opts.endDate}T23:59:59.999`);
  const q = opts.search.trim().toLowerCase();

  return bills.filter((o) => {
    const created = new Date(o.createdAt);
    if (created < start || created > end) return false;

    if (opts.selectedOrderType !== 'all' && o.type !== opts.selectedOrderType) return false;

    if (opts.showMyBillsOnly && opts.currentUserName) {
      if (o.orderTaker !== opts.currentUserName) return false;
    } else if (opts.selectedCashier !== 'all' && o.orderTaker !== opts.selectedCashier) {
      return false;
    }

    if (opts.selectedFloor !== 'all') {
      const floor = o.table != null ? opts.tableMap.get(o.table)?.floorId : undefined;
      if (floor !== opts.selectedFloor) return false;
    }

    if (q) {
      const tableName = o.table != null ? (opts.tableMap.get(o.table)?.name || String(o.table)) : '';
      const hay = `${o.id} ${tableName} ${o.customerName || ''} ${o.phone || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}
