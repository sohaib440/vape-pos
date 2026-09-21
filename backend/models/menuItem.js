const mongoose = require("mongoose");

const menuItemSchema = new mongoose.Schema(
  {
    name: String,
    price: Number,
    category: String,
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MenuCategory",
      default: null,
    },
    description: String,
    image: String,
    available: { type: Boolean, default: true },
    isFavorite: { type: Boolean, default: false },
    perishable: { type: Boolean, default: false },
    kitchenRequired: { type: Boolean, default: true },
    isBundle: { type: Boolean, default: false },
    recipe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recipe",
      default: null,
    },
    scale: {
      type: Number,
      default: 1,
      min: 0.1,
    },
    ingredientOverrides: [
      {
        inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem" },
        baseQuantity: { type: Number, min: 0 },
        unit: { type: String },
      },
    ],
    bundleItems: [
      {
        menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
        quantity: { type: Number, min: 1, default: 1 },
      },
    ],
  },
  { timestamps: true }
);

// Performance Indexes
menuItemSchema.index({ category: 1 });
menuItemSchema.index({ available: 1 });
menuItemSchema.index({ name: 1 });

module.exports = mongoose.model("MenuItem", menuItemSchema);
