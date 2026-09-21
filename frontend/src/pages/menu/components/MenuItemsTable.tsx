import { type MenuItem } from '@/data/pos/mockData';
import { resolveUploadUrl } from '@/lib/api/api';
import { Pencil, Trash2 } from 'lucide-react';
import { isMenuBundle } from '@/utils/menu/isMenuBundle';

interface MenuItemsTableProps {
  items: MenuItem[];
  page: number;
  pageSize: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: React.Dispatch<React.SetStateAction<number>>;
  meta: { hasNext: boolean; hasPrev: boolean };
  openEdit: (item: MenuItem) => void;
  deleteItem: (id: string) => void;
  toggleAvailability: (id: string) => void;
}

export function MenuItemsTable({
  items,
  page,
  pageSize,
  setPage,
  setPageSize,
  meta,
  openEdit,
  deleteItem,
  toggleAvailability,
}: MenuItemsTableProps) {
  return (
    <>
      <div className="pos-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card py-3 px-2 font-medium">#</th>
              <th className="py-3 px-2 font-medium">Item</th>
              <th className="py-3 px-2 font-medium">Category</th>
              <th className="py-3 px-2 font-medium">Recipe</th>
              <th className="py-3 px-2 font-medium">Kitchen</th>
              <th className="py-3 px-2 font-medium">Price (PKR)</th>
              <th className="py-3 px-2 font-medium">Status</th>
              <th className="py-3 px-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id} className="border-b border-border/50 last:border-0">
                <td className="sticky left-0 z-0 bg-card py-3 px-2 text-muted-foreground">
                  {(page - 1) * pageSize + index + 1}
                </td>
                <td className="py-3 px-2">
                  <div className="flex items-center gap-3">
                    {item.image ? (
                      <img src={resolveUploadUrl(item.image)} alt={item.name} className="h-12 w-12 rounded-lg object-cover border border-border" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-muted" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-medium text-foreground truncate">{item.name}</p>
                        {isMenuBundle(item) ? (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/20 text-secondary-foreground">Combo</span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{item.description}</p>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-2 text-muted-foreground">{item.category}</td>
                <td className="py-3 px-2">
                  {(item as { recipe?: { name?: string } } & MenuItem).recipe?.name ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {(item as { recipe?: { name?: string } } & MenuItem).recipe?.name}
                      {(item as { scale?: number } & MenuItem).scale &&
                      (item as { scale?: number } & MenuItem).scale !== 1
                        ? ` ×${(item as { scale?: number } & MenuItem).scale}`
                        : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-3 px-2 text-sm font-medium text-foreground">
                  {item.kitchenRequired !== false ? 'Yes' : 'No'}
                </td>
                <td className="py-3 px-2 font-semibold text-foreground">
                  Rs. {item.price.toLocaleString()}
                </td>
                <td className="py-3 px-2">
                  <button
                    onClick={() => toggleAvailability(item.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      item.available
                        ? 'bg-success/10 text-success'
                        : 'bg-destructive/10 text-destructive'
                    }`}
                  >
                    {item.available ? 'Available' : 'Unavailable'}
                  </button>
                </td>
                <td className="py-3 px-2 text-right">
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => openEdit(item)}
                      className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center w-full">
        {/* LEFT SIDE */}
        <label className="text-sm text-muted-foreground flex items-center gap-2">
          Show
          <select
            value={pageSize}
            onChange={e => {
              setPage(1);
              setPageSize(Number(e.target.value));
            }}
            className="bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            {[20, 50, 100].map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          records
        </label>

        {/* RIGHT SIDE */}
        <div className="flex gap-2">
          <button
            disabled={!meta.hasPrev}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-3 py-2 rounded-xl border border-border text-xs disabled:opacity-50"
          >
            Previous
          </button>
          <button
            disabled={!meta.hasNext}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-2 rounded-xl border border-border text-xs disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
