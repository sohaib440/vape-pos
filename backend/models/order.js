const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: ["dine-in", "takeaway", "delivery"], required: true },
    status: { type: String, enum: ["pending", "preparing", "ready", "served", "taken away", "completed", "cancelled"], required: true },
    table: String,
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: "Table", default: null, index: true },
    customerName: String,
    phone: String,
    deliveryAddress: String,
    orderTaker: String,
    notes: String,
    subtotal: Number,
    tax: Number,
    discount: Number,
    gstAmount: Number,
    serviceCharge: Number,
    takeawayCharge: Number,
    takeawayChargeEnabled: { type: Boolean, default: true },
    gstEnabled: { type: Boolean, default: true },
    paymentMethod: { type: String, enum: ["cash", "card", "easypesa"], default: "cash" },
    amountPaid: Number,
    advanceAmount: { type: Number, default: 0 },
    changeDue: Number,
    cashierName: String,
    total: Number,
    /** Set true after recipe ingredients are deducted on payment/completion. */
    inventoryDeducted: { type: Boolean, default: false },
    /** Staff member (Employee ID) this bill is assigned to */
    staffMember: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    /** Whether the staff member has paid this bill */
    staffBillPaid: { type: Boolean, default: false },
    items: [
      {
        quantity: Number,
        notes: String,
        requestId: String,
        requestAt: Date,
        extraName: String,
        extraPrice: Number,
        menuItem: {
          id: String,
          name: String,
          price: Number,
          category: String,
          kitchenRequired: { type: Boolean, default: true },
          isBundle: { type: Boolean, default: false },
          bundleItems: [
            {
              menuItem: String,
              name: String,
              quantity: Number,
            },
          ],
        },
      },
    ],
  },
  { timestamps: true }
);

// Performance Indexes
orderSchema.index({ status: 1 });
orderSchema.index({ type: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ table: 1 });
orderSchema.index({ code: 1 }, { unique: true });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ table: 1, status: 1, createdAt: -1 });
orderSchema.index({ type: 1, status: 1, createdAt: -1 });
orderSchema.index({ staffMember: 1 });
orderSchema.index({ staffMember: 1, staffBillPaid: 1 });
orderSchema.index(
  { tableId: 1 },
  {
    name: "active_dine_in_table_unique",
    unique: true,
    partialFilterExpression: {
      type: "dine-in",
      tableId: { $type: "objectId" },
      status: { $in: ["pending", "preparing", "ready", "served"] },
    },
  }
);

module.exports = mongoose.model("Order", orderSchema);
