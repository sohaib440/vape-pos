const LEGACY_BUNDLE_CATEGORIES = new Set(["deals", "platters"]);

const isMenuBundle = (item) => {
  if (!item) return false;
  if (item.isBundle === true) return true;
  if (Array.isArray(item.bundleItems) && item.bundleItems.length > 0) return true;
  return LEGACY_BUNDLE_CATEGORIES.has(String(item.category || "").toLowerCase());
};

const BUNDLE_MENU_QUERY = {
  $or: [
    { isBundle: true },
    { "bundleItems.0": { $exists: true } },
    { category: { $in: ["Deals", "Platters"] } },
  ],
};

module.exports = { isMenuBundle, BUNDLE_MENU_QUERY };
