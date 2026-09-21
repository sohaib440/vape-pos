const mongoose = require("mongoose");
const { parsePagination, buildPaginatedResponse } = require("../utils/pagination");
const { emitPosChange } = require("../utils/realtime");
const { MenuItem, MenuCategory, Recipe } = require("../models");
const Fuse = require("fuse.js");

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const parseBundleItems = (value) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (!value) return [];

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  return [];
};

const parseIngredientOverrides = (value) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (!value) return [];

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  return [];
};

// Cache for menu items to avoid repeated DB queries
let cachedMenuItems = null;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

const getMenuItemsWithCache = async () => {
  const now = Date.now();
  if (!cachedMenuItems || (now - lastCacheTime) > CACHE_TTL) {
    cachedMenuItems = await MenuItem.find().lean();
    lastCacheTime = now;
  }
  return cachedMenuItems;
};

const normalizeCategoryId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
};

const getCategoryTree = async () => {
  const categories = await MenuCategory.find().sort({ parentId: 1, name: 1 }).lean();
  const itemCounts = await MenuItem.aggregate([
    { $match: { categoryId: { $ne: null } } },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]);
  const counts = new Map(itemCounts.map((row) => [String(row._id), row.count]));
  const byParent = new Map();
  categories.forEach((category) => {
    const key = category.parentId ? String(category.parentId) : "root";
    const row = { ...category, id: String(category._id), itemCount: counts.get(String(category._id)) || 0, children: [] };
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  });
  const attachChildren = (rows) => rows.map((row) => ({ ...row, children: attachChildren(byParent.get(row.id) || []) }));
  return attachChildren(byParent.get("root") || []);
};

exports.list = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const q = String(req.query.search || "").trim();
    const categoryFilter = req.query.category && req.query.category !== "All" ? String(req.query.category) : null;
    const categoryIdFilter = normalizeCategoryId(req.query.categoryId);

    let items = [];
    let total = 0;

    // If no search query, use regular filtering
    if (!q) {
      const where = {};
      if (categoryIdFilter) where.categoryId = categoryIdFilter;
      else if (categoryFilter) where.category = categoryFilter;

      [items, total] = await Promise.all([
        MenuItem.find(where).sort({ isFavorite: -1, createdAt: -1 }).skip(skip).limit(limit).lean().populate("recipe").populate("bundleItems.menuItem", "name"),
        MenuItem.countDocuments(where)
      ]);

      return res.json(buildPaginatedResponse({
        items: items.map((i) => ({ ...i, id: String(i._id) })),
        total,
        page,
        limit
      }));
    }

    // Fuzzy search with Fuse.js
    const allItems = await getMenuItemsWithCache();

    // Apply category filter first if specified
    let itemsToSearch = allItems;
    if (categoryIdFilter || categoryFilter) {
      itemsToSearch = categoryIdFilter
        ? allItems.filter(item => String(item.categoryId) === String(categoryIdFilter))
        : allItems.filter(item => item.category === categoryFilter);
    }

    const fuseOptions = {
      keys: ['name', 'description', 'category'],
      threshold: 0.4,
      distance: 100,
      ignoreLocation: true,
      minMatchCharLength: 1,
      includeScore: true,
      includeMatches: true
    };

    const fuse = new Fuse(itemsToSearch, fuseOptions);
    const results = fuse.search(q);

    // Paginate results
    const start = skip;
    const end = start + limit;
    const paginatedResults = results.slice(start, end);

    const populated = await MenuItem.populate(paginatedResults.map(r => r.item), [{ path: "recipe" }, { path: "bundleItems.menuItem", select: "name" }]);

    res.json(buildPaginatedResponse({
      items: populated.map((item) => ({
        ...item,
        id: String(item._id),
        score: results.find(r => String(r.item._id) === String(item._id))?.score,
      })),
      total: results.length,
      page,
      limit
    }));
  } catch (error) {
    console.error("List menu error:", error);
    res.status(500).json({ message: error.message || "Failed to load menu" });
  }
};

exports.create = async (req, res) => {
  try {
    const categoryId = normalizeCategoryId(req.body.categoryId);
    const selectedCategory = categoryId ? await MenuCategory.findById(categoryId).lean() : null;
    if (categoryId && !selectedCategory) return res.status(400).json({ message: "Selected category not found" });
    if (selectedCategory && !selectedCategory.parentId) return res.status(400).json({ message: "Menu items must be assigned to a child category" });
    const payload = {
      ...req.body,
      categoryId,
      category: selectedCategory?.name || req.body.category || "",
      price: Number(req.body.price || 0),
      kitchenRequired: req.body.kitchenRequired === 'true' || req.body.kitchenRequired === true,
      isFavorite: req.body.isFavorite === 'true' || req.body.isFavorite === true,
      isBundle: req.body.isBundle === 'true' || req.body.isBundle === true,
      image: req.file ? `/uploads/menu/${req.file.filename}` : req.body.image || '',
      recipe: req.body.recipe || null,
      scale: Number(req.body.scale || 1),
      ingredientOverrides: parseIngredientOverrides(req.body.ingredientOverrides) || [],
      bundleItems: parseBundleItems(req.body.bundleItems) || [],
    };
    const row = await MenuItem.create(payload);
    // Invalidate cache
    cachedMenuItems = null;
    emitPosChange(["menu", "dashboard"]);
    res.status(201).json({ ...row.toObject(), id: String(row._id) });
  } catch (error) {
    console.error("Create menu item error:", error);
    res.status(500).json({ message: error.message || "Failed to create menu item" });
  }
};

exports.update = async (req, res) => {
  try {
    const payload = {};
    if (req.body.name !== undefined) payload.name = req.body.name;
    if (req.body.price !== undefined) payload.price = Number(req.body.price || 0);
    if (req.body.categoryId !== undefined) {
      const categoryId = normalizeCategoryId(req.body.categoryId);
      const selectedCategory = categoryId ? await MenuCategory.findById(categoryId).lean() : null;
      if (categoryId && !selectedCategory) return res.status(400).json({ message: "Selected category not found" });
      if (selectedCategory && !selectedCategory.parentId) return res.status(400).json({ message: "Menu items must be assigned to a child category" });
      payload.categoryId = categoryId;
      payload.category = selectedCategory?.name || "";
    } else if (req.body.category !== undefined) payload.category = req.body.category;
    if (req.body.description !== undefined) payload.description = req.body.description;
    if (req.body.kitchenRequired !== undefined) payload.kitchenRequired = req.body.kitchenRequired === 'true' || req.body.kitchenRequired === true;
    if (req.body.isFavorite !== undefined) payload.isFavorite = req.body.isFavorite === 'true' || req.body.isFavorite === true;
    if (req.body.isBundle !== undefined) {
      payload.isBundle = req.body.isBundle === 'true' || req.body.isBundle === true;
      if (!payload.isBundle) payload.bundleItems = [];
    }
    if (req.body.image !== undefined) payload.image = req.body.image;
    if (req.file) {
      payload.image = `/uploads/menu/${req.file.filename}`;
    }
    if (req.body.recipe !== undefined) payload.recipe = req.body.recipe || null;
    if (req.body.scale !== undefined) payload.scale = Number(req.body.scale || 1);
    if (req.body.ingredientOverrides !== undefined) payload.ingredientOverrides = parseIngredientOverrides(req.body.ingredientOverrides);
    if (req.body.bundleItems !== undefined) payload.bundleItems = parseBundleItems(req.body.bundleItems);

    const row = await MenuItem.findByIdAndUpdate(req.params.id, payload, { new: true }).populate("recipe").populate("bundleItems.menuItem", "name");
    if (!row) return res.status(404).json({ message: "Menu item not found" });
    // Invalidate cache
    cachedMenuItems = null;
    emitPosChange(["menu", "dashboard"]);
    res.json({ ...row.toObject(), id: String(row._id) });
  } catch (error) {
    console.error("Update menu item error:", error);
    res.status(500).json({ message: error.message || "Failed to update menu item" });
  }
};

exports.remove = async (req, res) => {
  try {
    await MenuItem.findByIdAndDelete(req.params.id);
    // Invalidate cache
    cachedMenuItems = null;
    emitPosChange(["menu", "dashboard"]);
    res.json({ ok: true });
  } catch (error) {
    console.error("Delete menu item error:", error);
    res.status(500).json({ message: error.message || "Failed to delete menu item" });
  }
};

exports.categories = async (req, res) => {
  try {
    const [fromMenu, customCategories, tree] = await Promise.all([
      MenuItem.distinct("category", { category: { $nin: [null, ""] } }),
      MenuCategory.find().sort({ parentId: 1, name: 1 }).lean(),
      getCategoryTree(),
    ]);
    const knownNames = new Set(customCategories.map((c) => c.name));
    const legacy = Array.from(new Set((fromMenu || []).filter(Boolean))).filter((name) => !knownNames.has(name));

    res.json({
      categories: Array.from(new Set([...customCategories.map((category) => category.name), ...legacy])).sort(),
      categoryRecords: customCategories.map((category) => ({ ...category, id: String(category._id) })),
      tree,
      legacy,
    });
  } catch (error) {
    console.error("List categories error:", error);
    res.status(500).json({ message: error.message || "Failed to load categories" });
  }
};

exports.addCategory = async (req, res) => {
  const { name, parentId, description, isActive } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Category name required' });
  }

  const trimmed = String(name).trim();
  try {
    const normalizedParentId = parentId && mongoose.Types.ObjectId.isValid(parentId) ? parentId : null;
    if (parentId && !normalizedParentId) return res.status(400).json({ error: 'Invalid parent category' });
    const parentCategory = normalizedParentId ? await MenuCategory.findById(normalizedParentId).select('parentId').lean() : null;
    if (normalizedParentId && !parentCategory) {
      return res.status(400).json({ error: 'Parent category not found' });
    }
    if (parentCategory?.parentId) return res.status(400).json({ error: 'Only parent categories can contain subcategories' });
    const existing = await MenuCategory.findOne({ name: trimmed, parentId: normalizedParentId });
    if (existing) {
      return res.status(409).json({ error: 'Category already exists' });
    }

    const category = await MenuCategory.create({
      name: trimmed,
      parentId: normalizedParentId,
      description: description || '',
      image: req.file ? `/uploads/menu/${req.file.filename}` : req.body.image || '',
      isActive: isActive !== false && isActive !== 'false',
    });
    if (normalizedParentId) {
      await MenuItem.updateMany(
        { category: trimmed, $or: [{ categoryId: null }, { categoryId: { $exists: false } }] },
        { $set: { categoryId: category._id } }
      );
    }
    emitPosChange(["menu"]);
    res.status(201).json({ id: String(category._id), name: category.name, parentId: category.parentId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const category = await MenuCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });
    const { name, parentId, description, isActive } = req.body || {};
    const nextParentId = parentId === undefined
      ? category.parentId
      : (parentId && mongoose.Types.ObjectId.isValid(parentId) ? parentId : null);
    if (parentId && !mongoose.Types.ObjectId.isValid(parentId)) return res.status(400).json({ error: 'Invalid parent category' });
    if (String(nextParentId || '') === String(category._id)) return res.status(400).json({ error: 'A category cannot be its own parent' });
    const nextParent = nextParentId ? await MenuCategory.findById(nextParentId).select('parentId').lean() : null;
    if (nextParentId && !nextParent) return res.status(400).json({ error: 'Parent category not found' });
    if (nextParent?.parentId) return res.status(400).json({ error: 'Only parent categories can contain subcategories' });
    if (name !== undefined) category.name = String(name).trim();
    category.parentId = nextParentId || null;
    if (description !== undefined) category.description = String(description);
    if (isActive !== undefined) category.isActive = isActive !== false && isActive !== 'false';
    if (req.file) category.image = `/uploads/menu/${req.file.filename}`;
    else if (req.body.image !== undefined) category.image = req.body.image;
    category.updatedAt = new Date();
    await category.save();
    if (category.parentId) {
      await MenuItem.updateMany(
        { category: category.name, $or: [{ categoryId: null }, { categoryId: { $exists: false } }] },
        { $set: { categoryId: category._id } }
      );
    }
    emitPosChange(["menu"]);
    res.json({ ...category.toObject(), id: String(category._id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.removeCategory = async (req, res) => {
  try {
    const category = await MenuCategory.findById(req.params.id).lean();
    if (!category) return res.status(404).json({ error: 'Category not found' });
    const [children, items] = await Promise.all([
      MenuCategory.find({ parentId: category._id }).select('name').lean(),
      MenuItem.find({ categoryId: category._id }).select('name').lean(),
    ]);
    if (children.length || items.length) {
      const details = [];
      if (children.length) details.push(`child categories: ${children.map((row) => row.name).join(', ')}`);
      if (items.length) details.push(`menu items: ${items.map((row) => row.name).join(', ')}`);
      return res.status(409).json({ error: `Cannot delete "${category.name}" because it has ${details.join(' and ')}.` });
    }
    await MenuCategory.deleteOne({ _id: category._id });
    emitPosChange(["menu"]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
