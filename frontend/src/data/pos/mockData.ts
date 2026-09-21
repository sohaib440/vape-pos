export interface MenuItem {
  id: string;
  name: string;
  price: number;
  halfPrice?: number;
  category: string;
  image: string;
  description: string;
  available: boolean;
  isFavorite?: boolean;
  perishable: boolean;
  kitchenRequired?: boolean;
  expiryDays?: number;
  isBundle?: boolean;
  bundleItems?: Array<{ menuItem: string; quantity: number }>;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes: string;
  extraName?: string;
  extraPrice?: number;
}

export interface Order {
  id: string;
  items: CartItem[];
  type: 'dine-in' | 'takeaway' | 'delivery';
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'taken away' | 'completed' | 'cancelled';
  table?: number;
  tableId?: string;
  total: number;
  tax: number;
  subtotal: number;
  discount: number;
  notes: string;
  createdAt: string;
  customerName?: string;
  phone?: string;
  deliveryAddress?: string;
  orderTaker?: string;
  gstEnabled?: boolean;
  takeawayChargeEnabled?: boolean;
  advanceAmount?: number;
  amountPaid?: number;
  changeDue?: number;
  paymentMethod?: string;
  cashierName?: string;
  takeawayCharge?: number;
  serviceCharge?: number;
  gstAmount?: number;
  staffMember?: string | null;
  staffBillPaid?: boolean;
}

export interface FloorInfo {
  id: string;
  name: string;
}

export interface TableInfo {
  id: number;
  mongoId: string;
  number: number;
  name: string;
  seats: number;
  floorId: string;
  status: 'available' | 'occupied' | 'reserved';
  currentOrder?: string;
}

export const testimonials = [
  { name: 'Ahmed Khan', rating: 5, text: 'The Shinwari karahi here is the best in town! Authentic flavors that remind me of Peshawar.', avatar: 'AK' },
  { name: 'Fatima Ali', rating: 5, text: 'Perfect family dining. The mutton platter is enormous and every item is cooked to perfection.', avatar: 'FA' },
  { name: 'Usman Malik', rating: 4, text: 'Great BBQ variety and the staff is always welcoming. The chicken malai boti is a must-try!', avatar: 'UM' },
  { name: 'Sana Rashid', rating: 5, text: 'From the special deals to the Kabli Pulao - everything is fresh and delicious. Highly recommended!', avatar: 'SR' },
];

export const galleryImages = [
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600',
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600',
  'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600',
  'https://images.unsplash.com/photo-1550966871-3ed3cdb51f3a?w=600',
  'https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?w=600',
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600',
  'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600',
  'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600',
];
