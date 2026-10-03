import { NavLink, Outlet, Link, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Monitor,
  ClipboardList,
  Grid3X3,
  ChefHat,
  Receipt,
  UtensilsCrossed,
  BarChart3,
  Users,
  ArrowLeft,
  Menu,
  X,
  LogOut,
  Package,
  UserCog,
  Truck,
  TrendingUp,
  Printer,
  LayoutGrid,
  Gift,
  Landmark,
  CreditCard,
  Percent,
  Smartphone,
  MapPinned,
  DollarSign,
  BookOpen,
} from 'lucide-react';
import { useState } from 'react';
import { usePOSStore } from '@/stores/pos/posStore';
import { useAuth, type PageKey } from '@/contexts/auth/AuthContext';
import { BrandHeader } from '@/components/branding/BrandHeader';
import Logo from '@/components/branding/Logo';

const allLinks: { to: string; icon: typeof LayoutDashboard; label: string; page: PageKey; end?: boolean }[] = [
  { to: '/pos', icon: LayoutDashboard, label: 'Dashboard', page: 'dashboard', end: true },
  { to: '/pos/hr', icon: UserCog, label: 'HR Management', page: 'hr' },
  { to: '/pos/terminal', icon: Monitor, label: 'POS Terminal', page: 'terminal' },
  { to: '/pos/orders', icon: ClipboardList, label: 'Orders', page: 'orders' },
  { to: '/pos/tables', icon: Grid3X3, label: 'Tables', page: 'tables' },
  { to: '/pos/kitchen', icon: ChefHat, label: 'Kitchen', page: 'kitchen' },
  { to: '/pos/billing', icon: Receipt, label: 'Billing', page: 'billing' },
  { to: '/pos/staff-bills', icon: Users, label: 'Staff Bills', page: 'staffbills' },
  { to: '/pos/menu', icon: UtensilsCrossed, label: 'Menu', page: 'menu' },
  { to: '/pos/menu/categories', icon: UtensilsCrossed, label: 'Menu Categories', page: 'menu' },
  { to: '/pos/recipes', icon: BookOpen, label: 'Recipes', page: 'recipes' },
  { to: '/pos/inventory', icon: Package, label: 'Inventory', page: 'inventory' },
  { to: '/pos/delivery', icon: Truck, label: 'Delivery', page: 'delivery' },
  { to: '/pos/reports', icon: BarChart3, label: 'Reports', page: 'reports' },
  { to: '/pos/analytics', icon: TrendingUp, label: 'Analytics', page: 'analytics' },
  { to: '/pos/expenses', icon: DollarSign, label: 'Expenses', page: 'expenses' },
  { to: '/pos/payment', icon: CreditCard, label: 'Payment details', page: 'payment' },
  { to: '/pos/printers', icon: Printer, label: 'Printers (×3)', page: 'printers' },
  { to: '/pos/pos-tabs', icon: LayoutGrid, label: 'POS tabs (×3)', page: 'postabs' },
  { to: '/pos/gift-loyalty', icon: Gift, label: 'Gift & loyalty', page: 'giftcards' },
  { to: '/pos/fbr', icon: Landmark, label: 'FBR POS', page: 'fbr' },
  { to: '/pos/tax', icon: Percent, label: 'Tax details', page: 'tax' },
  { to: '/pos/mobile-app', icon: Smartphone, label: 'Mobile app', page: 'mobileapp' },
  { to: '/pos/outdoor-delivery-report', icon: MapPinned, label: 'Outdoor delivery', page: 'outdoordelivery' },
  { to: '/pos/users', icon: Users, label: 'Users & Permissions', page: 'users' },
];

const roleBadge: Record<string, string> = {
  superadmin: 'bg-primary/20 text-primary-foreground',
  store_manager: 'bg-amber-100/50 text-amber-700',
  cashier: 'bg-success/20 text-success',
};

export default function POSLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, loading, logout, hasPageAccess, roleLabel } = useAuth();
  const { cart, setShowDiscardPopup, setPendingNavigation } = usePOSStore();

  const handleNavigation = (to: string) => {
    // Check if we're currently on the terminal page and have items in cart
    const isOnTerminal = window.location.pathname === '/pos/terminal';
    if (isOnTerminal && cart.length > 0) {
      setPendingNavigation(to);
      setShowDiscardPopup(true);
      return false; // Prevent navigation
    }
    setSidebarOpen(false);
    return true; // Allow navigation
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/pos/login" replace />;
  }

  const visibleLinks = allLinks.filter(link => hasPageAccess(link.page));

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-56 bg-sidebar flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="min-h-14 px-3 py-2.5 flex items-center justify-between border-b border-sidebar-border shrink-0">
          <Link to="/" className="inline-flex min-w-0 items-center max-w-[calc(100%-2rem)]">
            <BrandHeader variant="sidebar" />
          </Link>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-sidebar-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* User info */}
        <div className="px-3 py-3">
          <div className="bg-sidebar-accent/50 rounded-xl p-3">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${roleBadge[user.role] ?? 'bg-sky-100/50 text-sky-700'}`}>{roleLabel(user.role)}</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto scrollbar-thin">
          {visibleLinks.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={(e) => {
                if (!handleNavigation(link.to)) {
                  e.preventDefault();
                }
              }}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                }`
              }
            >
              <link.icon className="w-4 h-4 shrink-0" />
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-3 space-y-0.5 border-t border-sidebar-border">
          <Link to="/" onClick={(e) => {
            if (!handleNavigation('/')) {
              e.preventDefault();
            }
          }} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all">
            <ArrowLeft className="w-4 h-4" /> Back to Website
          </Link>
          <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-all">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-foreground/30 z-40 lg:hidden" />}

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-border flex items-center justify-between gap-3 px-4 shrink-0 bg-background/80 backdrop-blur-sm">
          <div className="flex min-w-0 flex-1 items-center">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden mr-3 shrink-0 text-foreground">
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-xs text-muted-foreground inline-flex min-w-0 items-center gap-2">
              <Logo size={22} showText={false} className="shrink-0" iconClassName="shrink-0" />
              <span className="truncate font-normal sm:hidden">Shangreela Heights</span>
              <span className="hidden truncate font-normal sm:inline">Shangreela Heights Shinwari BBQ Restaurant</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground hidden md:inline">{user.email}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-muted text-muted-foreground border border-border">
              {roleLabel(user.role)}
            </span>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
