import { X, Layers, ChevronDown, ChevronUp, Plus, Search } from 'lucide-react';
import React, { useMemo, useState, useEffect } from 'react';
import { type MenuItem } from '@/data/pos/mockData';
import { resolveUploadUrl } from '@/lib/api/api';
import { BASE_UNITS } from '@/pages/inventory/modals/AddItemModal';

type Recipe = {
  id: string;
  name: string;
  ingredients: Array<{
    inventoryItem: { _id: string; name: string; unit: string };
    baseQuantity: number;
    unit: string;
  }>;
};

type BundleEntry = { id: string; name: string; price: number; quantity: number };
type IngredientOverride = { inventoryItem: string; baseQuantity: number; unit: string };
type MergedIngredient = {
  inventoryItem: string;
  name: string;
  unit: string;
  quantity: number;
  isBase: boolean;
  isRemoved: boolean;
};
type InventoryItem = { _id: string; name: string; unit: string };

type FormState = {
  name: string;
  price: string;
  category: string;
  categoryId: string;
  parentCategoryId: string;
  description: string;
  kitchenRequired: boolean;
  isFavorite: boolean;
  image: string;
};

interface MenuItemFormModalProps {
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  editing: MenuItem | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  allCategories: string[];
  categoryTree: Array<{ id: string; name: string; parentId: string | null; isActive: boolean }>;
  categoryOptions: Array<{ id: string; name: string; parentId: string | null; isActive: boolean }>;
  isBundle: boolean;
  setIsBundle: (v: boolean) => void;
  bundleItems: BundleEntry[];
  setBundleItems: React.Dispatch<React.SetStateAction<BundleEntry[]>>;
  bundleItemId: string;
  setBundleItemId: (v: string) => void;
  bundleQty: string;
  setBundleQty: (v: string) => void;
  bundleSourceItems: MenuItem[];
  addBundleItem: () => void;
  selectedRecipeId: string | null;
  setSelectedRecipeId: (v: string | null) => void;
  scale: string;
  setScale: (v: string) => void;
  ingredientOverrides: IngredientOverride[];
  setIngredientOverrides: React.Dispatch<React.SetStateAction<IngredientOverride[]>>;
  showOverrides: boolean;
  setShowOverrides: (v: boolean) => void;
  showCreateRecipe: boolean;
  setShowCreateRecipe: (v: boolean) => void;
  newRecipeName: string;
  setNewRecipeName: (v: string) => void;
  newRecipeIngredients: Array<{ inventoryItem: string; baseQuantity: string; unit: string }>;
  setNewRecipeIngredients: React.Dispatch<React.SetStateAction<Array<{ inventoryItem: string; baseQuantity: string; unit: string }>>>;
  recipeSearch: string;
  setRecipeSearch: (v: string) => void;
  ingredientSearch: string;
  setIngredientSearch: (v: string) => void;
  overrideIngredientSearch: string;
  setOverrideIngredientSearch: (v: string) => void;
  recipes: Recipe[];
  selectedRecipe: Recipe | null;
  mergedRecipeIngredients: MergedIngredient[];
  overrideSearchResults: InventoryItem[];
  inventoryItems: InventoryItem[];
  imagePreviewUrl: string;
  handleImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  cleanupImagePreview: () => void;
  setImageFile: (f: File | null) => void;
  setImagePreviewUrl: (v: string) => void;
  save: () => void;
  saveRecipe: () => void;
  inputClass: string;
}

export function MenuItemFormModal({
  showForm, setShowForm, editing, form, setForm, allCategories, categoryTree, categoryOptions, isBundle, setIsBundle,
  bundleItems, setBundleItems, bundleItemId, setBundleItemId, bundleQty, setBundleQty,
  bundleSourceItems, addBundleItem, selectedRecipeId, setSelectedRecipeId,
  scale, setScale, ingredientOverrides, setIngredientOverrides,
  showOverrides, setShowOverrides, showCreateRecipe, setShowCreateRecipe,
  newRecipeName, setNewRecipeName, newRecipeIngredients, setNewRecipeIngredients,
  recipeSearch, setRecipeSearch, ingredientSearch, setIngredientSearch,
  overrideIngredientSearch, setOverrideIngredientSearch, recipes, selectedRecipe,
  mergedRecipeIngredients, overrideSearchResults, inventoryItems,
  imagePreviewUrl, handleImageChange, cleanupImagePreview, setImageFile,
  setImagePreviewUrl, save, saveRecipe, inputClass,
}: MenuItemFormModalProps) {
  const [bundleSearch, setBundleSearch] = useState('');
  const [bundleSearchDebounced, setBundleSearchDebounced] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setBundleSearchDebounced(bundleSearch), 250);
    return () => window.clearTimeout(t);
  }, [bundleSearch]);
  const filteredBundleSource = useMemo(() => {
    const q = bundleSearchDebounced.trim().toLowerCase();
    if (!q) return bundleSourceItems;
    return bundleSourceItems.filter(item => item.name.toLowerCase().includes(q));
  }, [bundleSearchDebounced, bundleSourceItems]);



  if (!showForm) return null;

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className={`bg-card rounded-2xl p-6 w-full ${!isBundle ? 'max-w-5xl' : 'max-w-2xl'} space-y-4`}
      >
        <div className="flex justify-between items-center">
          <h3 className="font-serif text-lg font-bold">{editing ? (isBundle ? 'Edit Deal / Platter' : 'Edit Menu Item') : (isBundle ? 'New Deal / Platter' : 'New Menu Item')}</h3>
          <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
        </div>

        <div className={!isBundle ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]' : ''}>
          {/* Left column - Menu Item Fields */}
          <div className="space-y-4">
            <input className={inputClass} placeholder="Item name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rs.</span>
              <input className={`${inputClass} pl-12`} placeholder="Price" type="number" step="1" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
            </div>
            <select className={inputClass} value={form.parentCategoryId} onChange={e => setForm({ ...form, parentCategoryId: e.target.value, categoryId: '', category: '' })}>
              <option value="">Select parent category</option>
              {categoryTree.filter(category => category.isActive).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select className={inputClass} value={form.categoryId || form.category} onChange={e => {
              const selected = categoryOptions.find(category => category.id === e.target.value);
              setForm({ ...form, categoryId: selected?.id || '', category: selected?.name || e.target.value });
            }}>
              <option value="">Select subcategory</option>
              {categoryOptions.filter(category => category.parentId === form.parentCategoryId).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              {allCategories.filter(category => !categoryOptions.some(option => option.name === category)).map(category => <option key={category} value={category}>{category}</option>)}
            </select>

            <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={isBundle}
                onChange={e => setIsBundle(e.target.checked)}
                className="accent-primary mt-0.5"
              />
              <span>
                <span className="text-foreground">Multiple items</span>
                <span className="block text-xs">Check this for a deal, platter, or any combo. The category name does not matter.</span>
              </span>
            </label>

            {isBundle && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-sm font-medium text-foreground">Select items and quantity</p>
                <div className="grid grid-cols-[1fr_92px_auto] gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search items..."
                      value={bundleSearch}
                      onChange={e => setBundleSearch(e.target.value)}
                      className={`${inputClass} mb-0`}
                    />
                    <div className="text-xs text-muted-foreground mt-1">Showing {filteredBundleSource.length} items</div>

                    <div className="absolute left-0 right-0 z-10 mt-10">
                      {bundleSearch.trim() !== '' && (
                        <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-card shadow-md">
                          {filteredBundleSource.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No items found.</p>
                          ) : (
                            filteredBundleSource.slice(0, 10).map((item) => (
                              <button key={item.id} type="button"
                                onClick={() => {
                                  setBundleItems(prev => {
                                    const existing = prev.find(p => p.id === item.id);
                                    if (existing) {
                                      return prev.map(p => p.id === item.id ? { ...p, quantity: p.quantity + 1 } : p);
                                    }
                                    return [...prev, { id: item.id, name: item.name, price: item.price, quantity: 1 }];
                                  });
                                  setBundleSearch('');
                                  setBundleSearchDebounced('');
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40 border-b border-border/50 last:border-0"
                              >
                                {item.image ? <img src={resolveUploadUrl(item.image)} alt={item.name} className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 rounded bg-muted/30" />}
                                <div className="flex-1">
                                  <div className="font-medium text-sm truncate">{item.name}</div>
                                  <div className="text-xs text-muted-foreground">{item.category}</div>
                                </div>
                                <div className="text-xs text-muted-foreground">Rs. {item.price}</div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>    
                </div>
                {bundleItems.length > 0 && (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                    {bundleItems.map(entry => (
                      <div key={entry.id} className="flex items-center justify-between rounded-lg bg-muted/60 px-2 py-1.5 text-xs">
                        <span className="truncate pr-2">{entry.name}</span>
                        <span className="truncate pr-2">Rs. {entry.price}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number" min="1" step="1" value={entry.quantity}
                            onChange={e => {
                              const qty = Math.max(1, Number(e.target.value) || 1);
                              setBundleItems(prev => prev.map(item => item.id === entry.id ? { ...item, quantity: qty } : item));
                            }}
                            className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-xs"
                          />
                          <button type="button" className="text-destructive hover:underline" onClick={() => setBundleItems(prev => prev.filter(x => x.id !== entry.id))}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={form.kitchenRequired} onChange={e => setForm({ ...form, kitchenRequired: e.target.checked })} className="accent-primary" />
                Send to kitchen
              </label>

              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={form.isFavorite} onChange={e => setForm({ ...form, isFavorite: e.target.checked })} className="accent-primary" />
                Mark as Favorite
              </label>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Item image</label>
              <input type="file" accept="image/*" onChange={handleImageChange} className={inputClass} />
              {form.image ? (
                <div className="relative">
                  <img src={resolveUploadUrl(form.image)} alt="Item preview" className="h-36 w-full rounded-xl object-cover border border-border" />
                  <button
                    type="button"
                    onClick={() => { cleanupImagePreview(); setImageFile(null); setImagePreviewUrl(''); setForm(prev => ({ ...prev, image: '' })); }}
                    className="absolute right-2 top-2 rounded-full bg-foreground/80 p-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
            <textarea className={`${inputClass} resize-none h-20`} placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>

          {/* Right column - Recipe Panel */}
          {!isBundle && (
            <div className="space-y-4 rounded-2xl border border-border bg-muted/20 p-4 lg:self-start">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Layers className="w-4 h-4" /> Recipe
                </label>
                {showCreateRecipe ? (
                  <button type="button" onClick={() => { setShowCreateRecipe(false); setNewRecipeName(''); setNewRecipeIngredients([]); setIngredientSearch(''); }} className="text-xs text-primary hover:underline">
                    Back to selection
                  </button>
                ) : (
                  <button type="button" onClick={() => setShowCreateRecipe(true)} className="px-3 rounded-xl bg-background text-foreground text-sm font-medium hover:bg-background/80 transition-colors whitespace-nowrap">
                    <Plus className="w-4 h-4 inline mr-1" /> New
                  </button>
                )}
              </div>

              {!showCreateRecipe && (
                <>
                  <div className="space-y-2">
                    <input type="text" placeholder="Search recipes..." value={recipeSearch} onChange={e => setRecipeSearch(e.target.value)} className={inputClass} />
                    <select className={inputClass} value={selectedRecipeId || ''} onChange={e => { setSelectedRecipeId(e.target.value || null); setIngredientOverrides([]); setShowOverrides(false); }}>
                      <option value="">No recipe</option>
                      {recipes.filter(r => r.name.toLowerCase().includes(recipeSearch.toLowerCase())).map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>

                  {selectedRecipe && (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground whitespace-nowrap">Scale:</label>
                        <input type="number" step="0.5" min="0.1" value={scale} onChange={e => setScale(e.target.value)} className={`${inputClass} w-24`} placeholder="1.0" />
                        <span className="text-xs text-muted-foreground">x multiplier</span>
                      </div>

                      <div className="rounded-xl border border-border p-3 space-y-1.5 bg-background">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Ingredients (base x scale)</p>
                        {mergedRecipeIngredients.map((ing, i) => (
                          <div key={i} className="flex justify-between gap-3 text-xs">
                            <span className="text-foreground">
                              {ing.name}
                              {!ing.isBase && <span className="ml-1 text-primary">(added)</span>}
                              {ing.isRemoved && <span className="ml-1 text-destructive">(removed)</span>}
                            </span>
                            <span className="text-muted-foreground font-mono text-right">{ing.quantity.toFixed(1)} {ing.unit}</span>
                          </div>
                        ))}
                      </div>

                      <button type="button" onClick={() => setShowOverrides(!showOverrides)} className="text-xs text-primary hover:underline flex items-center gap-1">
                        {showOverrides ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {showOverrides ? 'Hide' : 'Edit'} ingredient overrides
                      </button>

                      {showOverrides && (
                        <div className="space-y-3">
                          <div className="space-y-2">
                            {mergedRecipeIngredients.map((ing, i) => {
                              const baseIngredient = selectedRecipe.ingredients.find(base => base.inventoryItem._id === ing.inventoryItem);
                              const defaultQty = baseIngredient ? baseIngredient.baseQuantity * (parseFloat(scale) || 1) : 1;
                              const existing = ingredientOverrides.find(o => o.inventoryItem === ing.inventoryItem);
                              const isExtra = !baseIngredient;
                              const isRemoved = existing ? Number(existing.baseQuantity) === 0 : false;
                              const unit = existing?.unit || ing.unit;
                              const name = ing.name;
                              const itemId = ing.inventoryItem;

                              const upsertOverride = (quantity: number, nextUnit?: string) => {
                                setIngredientOverrides(prev => {
                                  const filtered = prev.filter(o => o.inventoryItem !== itemId);
                                  return [...filtered, { inventoryItem: itemId, baseQuantity: quantity, unit: nextUnit || unit }];
                                });
                              };
                              const clearOverride = () => setIngredientOverrides(prev => prev.filter(o => o.inventoryItem !== itemId));
                              const removeIngredient = () => { if (isExtra) { clearOverride(); return; } upsertOverride(0, unit); };
                              const restoreIngredient = () => clearOverride();

                              return (
                                <div key={i} className="rounded-xl border border-border bg-background p-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-foreground w-32 truncate">
                                      {name}{isExtra && <span className="ml-1 text-primary">(added)</span>}
                                    </span>
                                    <input
                                      type="number" step="any" min="0"
                                      value={existing ? existing.baseQuantity : ''}
                                      placeholder={defaultQty.toFixed(1)}
                                      disabled={isRemoved && !isExtra}
                                      onChange={e => { const val = e.target.value; if (!val) { clearOverride(); } else { upsertOverride(parseFloat(val), unit); } }}
                                      className={`${inputClass} w-24`}
                                    />
                                    <select value={unit} onChange={e => { const nextUnit = e.target.value; const nextQuantity = existing ? existing.baseQuantity : defaultQty; upsertOverride(nextQuantity, nextUnit); }} className={`${inputClass} w-24 text-xs`}>
                                      {BASE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                    {isRemoved ? (
                                      <button type="button" onClick={restoreIngredient} className="text-xs text-primary hover:underline">Restore</button>
                                    ) : (
                                      <button type="button" onClick={removeIngredient} className="text-xs text-destructive hover:underline">Remove</button>
                                    )}
                                  </div>
                                  {isRemoved && !isExtra && <p className="mt-1 text-[11px] text-destructive">This ingredient will be removed for this menu item.</p>}
                                </div>
                              );
                            })}
                          </div>

                          <div className="space-y-2 rounded-xl border border-dashed border-border bg-background/60 p-3">
                            <p className="text-xs font-medium text-muted-foreground">Add ingredient for this item</p>
                            <input type="text" placeholder="Search inventory items..." value={overrideIngredientSearch} onChange={e => setOverrideIngredientSearch(e.target.value)} className={inputClass} />
                            {overrideIngredientSearch.trim() !== '' && (
                              <div className="max-h-40 overflow-y-auto rounded-xl border border-border">
                                {overrideSearchResults.map(item => (
                                  <button key={item._id} type="button"
                                    onClick={() => { setIngredientOverrides(prev => [...prev.filter(o => o.inventoryItem !== item._id), { inventoryItem: item._id, baseQuantity: 1, unit: item.unit }]); setOverrideIngredientSearch(''); }}
                                    className="flex w-full items-center justify-between border-b border-border/50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40"
                                  >
                                    <span>{item.name}</span>
                                    <span className="text-xs text-muted-foreground">{item.unit}</span>
                                  </button>
                                ))}
                                {overrideSearchResults.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No ingredients available to add.</p>}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {showCreateRecipe && (
                <>
                  <input type="text" placeholder="Recipe name (e.g. Biryani Base)" value={newRecipeName} onChange={e => setNewRecipeName(e.target.value)} className={inputClass} />
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Ingredients</p>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 w-4 h-4 text-muted-foreground" />
                      <input type="text" placeholder="Search inventory items..." className={`${inputClass} pl-10 text-sm`} value={ingredientSearch} onChange={e => setIngredientSearch(e.target.value)} />
                    </div>
                    <div className="border border-border rounded-xl max-h-64 overflow-y-auto bg-muted/20">
                      {ingredientSearch === '' ? (
                        <p className="text-xs text-muted-foreground text-center py-4">Type to search ingredients</p>
                      ) : inventoryItems.filter(item => item.name.toLowerCase().includes(ingredientSearch.toLowerCase())).map(item => (
                        <button key={item._id} type="button"
                          onClick={() => {
                            const exists = newRecipeIngredients.some(i => i.inventoryItem === item._id);
                            if (exists) { return; }
                            setNewRecipeIngredients(prev => [...prev, { inventoryItem: item._id, baseQuantity: '', unit: item.unit }]);
                            setIngredientSearch('');
                          }}
                          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/50 border-b border-border/50 last:border-0 text-left transition-colors"
                        >
                          <span className="font-medium text-sm">{item.name}</span>
                          <span className="text-xs text-muted-foreground">{item.unit}</span>
                        </button>
                      ))}
                      {ingredientSearch !== '' && inventoryItems.filter(item => item.name.toLowerCase().includes(ingredientSearch.toLowerCase())).length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-4">No items found</p>
                      )}
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {newRecipeIngredients.map((ing, i) => (
                        <div key={i} className="flex items-center gap-2 bg-muted/30 rounded-xl px-3 py-2">
                          <span className="flex-1 font-medium text-sm">{inventoryItems.find(x => x._id === ing.inventoryItem)?.name || 'Unknown'}</span>
                          <input type="number" step="any" min="0" placeholder="Qty" value={ing.baseQuantity}
                            onChange={e => { const updated = [...newRecipeIngredients]; updated[i].baseQuantity = e.target.value; setNewRecipeIngredients(updated); }}
                            className={`${inputClass} w-20 text-sm`}
                          />
                          <select value={ing.unit} onChange={e => { const updated = [...newRecipeIngredients]; updated[i].unit = e.target.value; setNewRecipeIngredients(updated); }} className={`${inputClass} w-24 text-xs`}>
                            {BASE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <button type="button" onClick={() => setNewRecipeIngredients(prev => prev.filter((_, idx) => idx !== i))} className="text-destructive hover:text-destructive/80">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      {newRecipeIngredients.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Search and add ingredients above</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={saveRecipe} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-secondary transition-colors">
                      Save Recipe
                    </button>
                    <button type="button" onClick={() => { setShowCreateRecipe(false); setNewRecipeName(''); setNewRecipeIngredients([]); setIngredientSearch(''); }} className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <button onClick={save} className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
          {editing ? 'Update' : 'Add'} {isBundle ? 'Deal / Platter' : 'Menu Item'}
        </button>
      </div>
    </div>
  );
}
