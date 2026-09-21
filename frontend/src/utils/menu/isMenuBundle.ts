const LEGACY_BUNDLE_CATEGORIES = new Set(['deals', 'platters']);

export function isMenuBundle(item?: {
  isBundle?: boolean;
  bundleItems?: unknown[];
  category?: string;
} | null): boolean {
  if (!item) return false;
  if (item.isBundle === true) return true;
  if (Array.isArray(item.bundleItems) && item.bundleItems.length > 0) return true;
  return LEGACY_BUNDLE_CATEGORIES.has(String(item.category || '').toLowerCase());
}
