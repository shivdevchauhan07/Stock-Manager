import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  AlertCircle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Boxes, Check,
  CircleHelp, Clock3, DollarSign, LayoutDashboard, LoaderCircle, Package, Pencil,
  Plus, Search, ShoppingBag, Trash2, TrendingDown, X,
} from 'lucide-react';

const queryClient = new QueryClient();

type Product = {
  id: number | string;
  name: string;
  sku: string | null;
  category: string | null;
  supplier: string | null;
  price: number;
  quantity: number;
  low_stock_threshold: number;
  created_at: string;
  updated_at: string;
};
type Summary = {
  total_products: number;
  total_stock_units: number;
  total_stock_value: number;
  low_stock_count: number;
};
type Activity = {
  id?: number | string;
  type?: 'received' | 'sold' | string;
  quantity?: number;
  product_name?: string;
  name?: string;
  sku?: string;
  created_at?: string;
  timestamp?: string;
};
type ModalState =
  | { type: 'create' }
  | { type: 'edit'; product: Product }
  | { type: 'stock'; product: Product }
  | { type: 'delete'; product: Product }
  | null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/stock-api${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return body as T;
}

function money(value: number | undefined | null) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value));
}
function number(value: number | undefined | null) {
  return value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('en-US').format(Number(value));
}
function relativeTime(date?: string) {
  if (!date) return 'Time unavailable';
  const stamp = new Date(date).getTime();
  if (!Number.isFinite(stamp)) return 'Time unavailable';
  const mins = Math.max(0, Math.floor((Date.now() - stamp) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(stamp);
}

function AppHome() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [categories, setCategories] = useState<string[] | null>(null);
  const [suppliers, setSuppliers] = useState<string[] | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState({ products: true, summary: true, activity: true });
  const [errors, setErrors] = useState<{ products?: string; summary?: string; activity?: string; mutation?: string }>({});
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchText.trim()), 260);
    return () => window.clearTimeout(timeout);
  }, [searchText]);

  const loadProducts = useCallback(async () => {
    setLoading((state) => ({ ...state, products: true }));
    setErrors((state) => ({ ...state, products: undefined }));
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (categoryFilter) params.set('category', categoryFilter);
      if (supplierFilter) params.set('supplier', supplierFilter);
      const query = params.size ? `?${params.toString()}` : '';
      const result = await api<{ products: Product[]; categories: string[]; suppliers: string[] }>(`/products${query}`);
      setProducts(result.products);
      setCategories(result.categories);
      setSuppliers(result.suppliers);
    } catch (error) {
      setErrors((state) => ({ ...state, products: error instanceof Error ? error.message : 'Could not load products.' }));
    } finally {
      setLoading((state) => ({ ...state, products: false }));
    }
  }, [search, categoryFilter, supplierFilter]);

  const loadSummary = useCallback(async () => {
    setLoading((state) => ({ ...state, summary: true }));
    setErrors((state) => ({ ...state, summary: undefined }));
    try {
      setSummary(await api<Summary>('/summary'));
    } catch (error) {
      setErrors((state) => ({ ...state, summary: error instanceof Error ? error.message : 'Could not load the summary.' }));
    } finally {
      setLoading((state) => ({ ...state, summary: false }));
    }
  }, []);

  const loadActivity = useCallback(async () => {
    setLoading((state) => ({ ...state, activity: true }));
    setErrors((state) => ({ ...state, activity: undefined }));
    try {
      const result = await api<{ activities: Activity[] }>('/activity');
      setActivities(result.activities);
    } catch (error) {
      setErrors((state) => ({ ...state, activity: error instanceof Error ? error.message : 'Could not load recent activity.' }));
    } finally {
      setLoading((state) => ({ ...state, activity: false }));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadProducts(), loadSummary(), loadActivity()]);
  }, [loadProducts, loadSummary, loadActivity]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => { void loadSummary(); void loadActivity(); }, [loadSummary, loadActivity]);

  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (modal?.type !== 'create' && modal?.type !== 'edit') return;
    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get('name') ?? '').trim(),
      sku: String(data.get('sku') ?? '').trim(),
      category: String(data.get('category') ?? '').trim(),
      supplier: String(data.get('supplier') ?? '').trim(),
      price: Number(data.get('price')),
      low_stock_threshold: Number(data.get('low_stock_threshold')),
      ...(modal.type === 'create' ? { quantity: Number(data.get('quantity')) } : {}),
    };
    setWriting(true);
    setErrors((state) => ({ ...state, mutation: undefined }));
    try {
      if (modal.type === 'create') {
        await api<{ product: Product }>('/products', { method: 'POST', body: JSON.stringify(payload) });
        setNotice('Product added to your inventory.');
      } else {
        await api<{ product: Product }>(`/products/${modal.product.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setNotice('Product details updated.');
      }
      setModal(null);
      await refreshAll();
    } catch (error) {
      setErrors((state) => ({ ...state, mutation: error instanceof Error ? error.message : 'Could not save this product.' }));
    } finally {
      setWriting(false);
    }
  };

  const submitMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (modal?.type !== 'stock') return;
    const data = new FormData(event.currentTarget);
    const quantity = Number(data.get('quantity'));
    const type = String(data.get('type')) as 'received' | 'sold';
    setWriting(true);
    setErrors((state) => ({ ...state, mutation: undefined }));
    try {
      await api<{ product: Product; movement: unknown }>(`/products/${modal.product.id}/stock`, {
        method: 'POST', body: JSON.stringify({ type, quantity }),
      });
      setNotice(type === 'received' ? 'Stock received and inventory updated.' : 'Sale recorded and inventory updated.');
      setModal(null);
      await refreshAll();
    } catch (error) {
      setErrors((state) => ({ ...state, mutation: error instanceof Error ? error.message : 'Could not record the stock movement.' }));
    } finally {
      setWriting(false);
    }
  };

  const deleteProduct = async () => {
    if (modal?.type !== 'delete') return;
    setWriting(true);
    setErrors((state) => ({ ...state, mutation: undefined }));
    try {
      await api<{ message: string }>(`/products/${modal.product.id}`, { method: 'DELETE' });
      setNotice('Product removed from inventory.');
      setModal(null);
      await refreshAll();
    } catch (error) {
      setErrors((state) => ({ ...state, mutation: error instanceof Error ? error.message : 'Could not delete this product.' }));
    } finally {
      setWriting(false);
    }
  };

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const lowCount = summary?.low_stock_count ?? null;
  const listedCount = products?.length;
  const hasProductFilters = Boolean(search || categoryFilter || supplierFilter);
  const today = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date()), []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Boxes size={19} strokeWidth={2.2} /></div>
          <div><div className="brand-name">stockwise</div><div className="brand-tag">Inventory, in order</div></div>
        </div>
        <div className="nav-caption">Workspace</div>
        <button className="nav-link active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} data-testid="nav-overview">
          <LayoutDashboard size={16} /> Overview
        </button>
        <button className="nav-link" onClick={() => document.getElementById('inventory')?.scrollIntoView({ behavior: 'smooth' })} data-testid="nav-products">
          <Package size={16} /> Products
          {lowCount != null && lowCount > 0 && <span style={{ marginLeft: 'auto', fontFamily: 'var(--app-font-mono)', fontSize: 10 }}>{lowCount}</span>}
        </button>
        <button className="nav-link" onClick={() => document.getElementById('activity')?.scrollIntoView({ behavior: 'smooth' })} data-testid="nav-activity">
          <Clock3 size={16} /> Activity
        </button>
        <div className="sidebar-bottom">
          <div className="help-card">
            <CircleHelp size={16} color="#66816a" />
            <strong>A little help goes a long way</strong>
            <p>Keep quantities current to know exactly what is on your shelves.</p>
          </div>
          <div className="sidebar-foot">A clearer view of your shop.</div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="crumb"><b>Workspace</b> &nbsp;/&nbsp; Overview</div>
          <div className="mobile-brand"><div className="brand-mark"><Boxes size={17} /></div>stockwise</div>
          <div className="top-actions"><div className="date-label">{today}</div><div className="avatar" aria-label="Shop owner">SO</div></div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">Your shop at a glance</div>
              <h1>Good to see you.</h1>
              <p className="page-subtitle">Here’s where your inventory stands today.</p>
            </div>
            <button className="button button-primary" onClick={() => { setErrors((state) => ({ ...state, mutation: undefined })); setModal({ type: 'create' }); }} data-testid="button-add-product">
              <Plus size={16} /> Add a product
            </button>
          </div>

          {(errors.summary || errors.products || errors.activity) && (
            <div className="error-banner" role="alert" data-testid="status-load-error">
              <AlertCircle size={16} />
              <span>{[errors.summary, errors.products, errors.activity].filter(Boolean).join(' ')}</span>
              <button className="button button-quiet" style={{ marginLeft: 'auto' }} onClick={() => void refreshAll()} data-testid="button-retry-load">Try again</button>
            </div>
          )}

          <section className="summary-grid" aria-label="Inventory summary">
            <SummaryCard icon={<Package size={15} />} title="Products" value={loading.summary ? null : number(summary?.total_products)} note="Different items in your shop" />
            <SummaryCard icon={<Boxes size={15} />} title="Stock units" value={loading.summary ? null : number(summary?.total_stock_units)} note="Pieces across all products" />
            <SummaryCard icon={<DollarSign size={15} />} title="Stock value" value={loading.summary ? null : money(summary?.total_stock_value)} note="Based on your product prices" />
            <SummaryCard icon={<TrendingDown size={15} />} title="Running low" value={loading.summary ? null : number(summary?.low_stock_count)} note="At or below your threshold" attention />
          </section>

          <div className="content-grid">
            <section className="panel" id="inventory">
              <div className="panel-header">
                <div><h2 className="panel-title">Your products</h2><div className="panel-caption">{listedCount == null ? 'A practical view of everything you carry' : `${number(listedCount)} ${listedCount === 1 ? 'item' : 'items'} in this view`}</div></div>
                <div className="product-controls">
                  <label className="searchbox"><Search size={15} /><input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search name, SKU, category or supplier" aria-label="Search products" data-testid="input-product-search" /></label>
                  <select className="product-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category" data-testid="filter-product-category">
                    <option value="">All categories</option>
                    {(categories ?? []).map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                  <select className="product-filter" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} aria-label="Filter by supplier" data-testid="filter-product-supplier">
                    <option value="">All suppliers</option>
                    {(suppliers ?? []).map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
                  </select>
                </div>
              </div>
              {errors.products ? (
                <div className="empty-state"><div className="empty-illustration"><AlertCircle size={20} /></div><h3>Products did not load</h3><p>{errors.products}</p><button className="button button-secondary" onClick={() => void loadProducts()} data-testid="button-retry-products">Try again</button></div>
              ) : loading.products && !products ? <ProductSkeleton /> : products?.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-illustration"><ShoppingBag size={20} /></div>
                  <h3>{hasProductFilters ? 'No matching products' : 'Your shelves are ready'}</h3>
                  <p>{hasProductFilters ? 'Try another search or clear one of the filters.' : 'Add the items you sell to see stock levels, value, and movement all in one place.'}</p>
                  {!hasProductFilters && <button className="button button-primary" onClick={() => setModal({ type: 'create' })} data-testid="button-empty-add"><Plus size={15} /> Add your first product</button>}
                </div>
              ) : (
                <>
                  <div className="table-scroll">
                    <table className="product-table">
                      <thead><tr><th>Product</th><th>Category</th><th>Supplier</th><th>Price</th><th>In stock</th><th>Threshold</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                      <tbody>
                        {products?.map((product) => {
                          const isLow = Number(product.quantity) <= Number(product.low_stock_threshold);
                          return <tr key={product.id} data-testid={`row-product-${product.id}`}>
                            <td><span className="product-name">{product.name}</span><span className="sku">{product.sku || 'No SKU'}</span></td>
                            <td>{product.category || '—'}</td>
                            <td>{product.supplier || '—'}</td>
                            <td className="money">{money(product.price)}</td>
                            <td><span className={`stock-badge ${isLow ? 'low' : ''}`}><i className="stock-dot" />{number(product.quantity)}</span></td>
                            <td className="quantity">{number(product.low_stock_threshold)}</td>
                            <td><div className="row-actions">
                              <button className="row-action" title="Record stock movement" aria-label={`Record stock movement for ${product.name}`} onClick={() => { setErrors((state) => ({ ...state, mutation: undefined })); setModal({ type: 'stock', product }); }} data-testid={`button-stock-${product.id}`}><ArrowLeftRight size={15} /></button>
                              <button className="row-action" title="Edit product" aria-label={`Edit ${product.name}`} onClick={() => { setErrors((state) => ({ ...state, mutation: undefined })); setModal({ type: 'edit', product }); }} data-testid={`button-edit-${product.id}`}><Pencil size={14} /></button>
                              <button className="row-action delete" title="Delete product" aria-label={`Delete ${product.name}`} onClick={() => { setErrors((state) => ({ ...state, mutation: undefined })); setModal({ type: 'delete', product }); }} data-testid={`button-delete-${product.id}`}><Trash2 size={14} /></button>
                            </div></td>
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-footer"><span>{hasProductFilters ? 'Filtered products' : 'Inventory overview'}</span><span>Updated just now</span></div>
                </>
              )}
            </section>

            <section className="panel activity-panel" id="activity">
              <div className="panel-header">
                <div><h2 className="panel-title">Recent activity</h2><div className="panel-caption">The latest changes to your stock</div></div>
                <button className="button-icon" onClick={() => void loadActivity()} aria-label="Refresh activity" title="Refresh activity" data-testid="button-refresh-activity"><LoaderCircle size={15} className={loading.activity ? 'spin' : ''} /></button>
              </div>
              {errors.activity ? <div className="activity-empty" role="alert">{errors.activity}<br /><button className="button button-quiet" style={{ marginTop: 10 }} onClick={() => void loadActivity()} data-testid="button-retry-activity">Try again</button></div> : loading.activity && !activities ? (
                <div className="activity-list">{[0, 1, 2].map((item) => <div className="activity-item" key={item}><div className="skeleton" style={{ width: 29, height: 29, flex: '0 0 29px' }} /><div style={{ flex: 1 }}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" style={{ width: '40%', marginTop: 8 }} /></div></div>)}</div>
              ) : activities?.length === 0 ? <div className="activity-empty">No stock movements yet.<br />They’ll show up here as you receive or sell items.</div> : (
                <div className="activity-list">
                  {activities?.slice(0, 8).map((activity, index) => {
                    const sold = activity.type === 'sold';
                    const activityName = activity.product_name || activity.name || 'Product';
                    const time = relativeTime(activity.created_at || activity.timestamp);
                    return <div className="activity-item" key={activity.id ?? `${activityName}-${index}`}>
                      <div className={`activity-mark ${sold ? 'sold' : ''}`}>{sold ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}</div>
                      <div className="activity-copy"><div className="activity-main"><strong>{activityName}</strong><br />{sold ? 'Sold from stock' : activity.type === 'received' ? 'Stock received' : 'Stock updated'}</div><div className="activity-time">{time}</div></div>
                      {activity.quantity != null && <div className={`activity-qty ${sold ? 'sold' : ''}`}>{sold ? '−' : '+'}{number(activity.quantity)}</div>}
                    </div>;
                  })}
                </div>
              )}
              <div className="table-footer"><span>Latest movements</span><span>{activities ? `${activities.length} total` : ''}</span></div>
            </section>
          </div>
        </main>
      </div>

      {notice && <div className="notice-toast" role="status" data-testid="status-success"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={14} /></button></div>}
      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !writing) setModal(null); }}>
        {modal.type === 'create' || modal.type === 'edit' ? (
          <ProductForm key={modal.type === 'edit' ? `edit-${modal.product.id}` : 'create'} mode={modal.type} product={modal.type === 'edit' ? modal.product : undefined} onSubmit={submitProduct} onClose={() => setModal(null)} error={errors.mutation} busy={writing} />
        ) : modal.type === 'stock' ? (
          <StockForm key={`stock-${modal.product.id}`} product={modal.product} onSubmit={submitMovement} onClose={() => setModal(null)} error={errors.mutation} busy={writing} />
        ) : (
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="modal-heading"><div><h2 id="delete-title">Remove this product?</h2><p>This cannot be undone.</p></div><button className="close-btn" onClick={() => setModal(null)} disabled={writing} aria-label="Close dialog" data-testid="button-close-delete"><X size={17} /></button></div>
            <p className="delete-confirm"><strong>{modal.product.name}</strong> will be removed from your inventory. Any stock records associated with it may no longer be available.</p>
            {errors.mutation && <div className="modal-error" role="alert">{errors.mutation}</div>}
            <div className="modal-footer"><button className="button button-secondary" onClick={() => setModal(null)} disabled={writing} data-testid="button-cancel-delete">Keep product</button><button className="button button-danger" onClick={() => void deleteProduct()} disabled={writing} data-testid="button-confirm-delete">{writing ? 'Removing…' : 'Remove product'}</button></div>
          </section>
        )}
      </div>}
    </div>
  );
}

function SummaryCard({ icon, title, value, note, attention = false }: { icon: ReactNode; title: string; value: string | null; note: string; attention?: boolean }) {
  return <article className={`summary-card ${attention ? 'attention' : ''}`} data-testid={`card-summary-${title.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="summary-top"><span>{title}</span><span className="summary-icon">{icon}</span></div>
    <div className="summary-number">{value == null ? <span className="skeleton" style={{ display: 'block', width: 91, height: 24 }} /> : value}</div>
    <div className="summary-note">{note}</div>
  </article>;
}

function ProductSkeleton() {
  return <div className="table-scroll"><table className="product-table"><thead><tr><th>Product</th><th>Category</th><th>Supplier</th><th>Price</th><th>In stock</th><th>Threshold</th><th>Actions</th></tr></thead><tbody>
    {[0, 1, 2, 3].map((item) => <tr className="skeleton-row" key={item}><td><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" style={{ width: '37%', marginTop: 8 }} /></td><td><div className="skeleton skeleton-line" /></td><td><div className="skeleton skeleton-line" /></td><td><div className="skeleton skeleton-line" /></td><td><div className="skeleton skeleton-line" /></td><td><div className="skeleton skeleton-line" /></td><td /></tr>)}
  </tbody></table></div>;
}

function ProductForm({ mode, product, onSubmit, onClose, error, busy }: {
  mode: 'create' | 'edit'; product?: Product; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; error?: string; busy: boolean;
}) {
  return <form className="modal" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="product-form-title">
    <div className="modal-heading"><div><h2 id="product-form-title">{mode === 'create' ? 'Add a product' : 'Edit product'}</h2><p>{mode === 'create' ? 'Start keeping track of something you sell.' : 'Update the details for this item.'}</p></div><button type="button" className="close-btn" onClick={onClose} disabled={busy} aria-label="Close dialog" data-testid="button-close-product"><X size={17} /></button></div>
    <div className="form-grid">
      <div className="field full"><label htmlFor="product-name">Product name</label><input id="product-name" name="name" required maxLength={120} placeholder="e.g. Canvas tote bag" defaultValue={product?.name ?? ''} data-testid="input-product-name" /></div>
       <div className="field"><label htmlFor="product-sku">SKU <span className="field-hint">(optional)</span></label><input id="product-sku" name="sku" maxLength={40} placeholder="e.g. BAG-014" defaultValue={product?.sku ?? ''} data-testid="input-product-sku" /></div>
       <div className="field"><label htmlFor="product-price">Unit price (₹)</label><input id="product-price" name="price" type="number" min="0" step="0.01" required placeholder="0.00" defaultValue={product?.price ?? ''} data-testid="input-product-price" /></div>
       <div className="field"><label htmlFor="product-category">Category <span className="field-hint">(optional)</span></label><input id="product-category" name="category" maxLength={80} placeholder="e.g. Accessories" defaultValue={product?.category ?? ''} data-testid="input-product-category" /></div>
       <div className="field"><label htmlFor="product-supplier">Supplier <span className="field-hint">(optional)</span></label><input id="product-supplier" name="supplier" maxLength={120} placeholder="e.g. Northside Goods" defaultValue={product?.supplier ?? ''} data-testid="input-product-supplier" /></div>
      {mode === 'create' && <div className="field"><label htmlFor="product-quantity">Starting quantity</label><input id="product-quantity" name="quantity" type="number" min="0" step="1" required placeholder="0" defaultValue="0" data-testid="input-product-quantity" /></div>}
      <div className={`field ${mode === 'edit' ? '' : ''}`}><label htmlFor="product-threshold">Low stock alert at</label><input id="product-threshold" name="low_stock_threshold" type="number" min="0" step="1" required placeholder="5" defaultValue={product?.low_stock_threshold ?? 5} data-testid="input-product-threshold" /><span className="field-hint">We’ll flag it when stock reaches this level.</span></div>
    </div>
    {error && <div className="modal-error" role="alert" data-testid="status-mutation-error">{error}</div>}
    <div className="modal-footer"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy} data-testid="button-cancel-product">Cancel</button><button className="button button-primary" type="submit" disabled={busy} data-testid="button-save-product">{busy ? 'Saving…' : mode === 'create' ? 'Add product' : 'Save changes'}</button></div>
  </form>;
}

function StockForm({ product, onSubmit, onClose, error, busy }: {
  product: Product; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; error?: string; busy: boolean;
}) {
  const [type, setType] = useState<'received' | 'sold'>('received');
  return <form className="modal" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="stock-form-title">
    <div className="modal-heading"><div><h2 id="stock-form-title">Update stock</h2><p><strong>{product.name}</strong> currently has {number(product.quantity)} in stock.</p></div><button type="button" className="close-btn" onClick={onClose} disabled={busy} aria-label="Close dialog" data-testid="button-close-stock"><X size={17} /></button></div>
    <div className="field"><label>What happened?</label><div className="movement-type">
      <button type="button" onClick={() => setType('received')} className={`movement-choice ${type === 'received' ? 'selected receive' : ''}`} data-testid="button-movement-received"><ArrowDownLeft size={15} /> Received</button>
      <button type="button" onClick={() => setType('sold')} className={`movement-choice ${type === 'sold' ? 'selected sell' : ''}`} data-testid="button-movement-sold"><ArrowUpRight size={15} /> Sold</button>
    </div></div>
    <input type="hidden" name="type" value={type} />
    <div className="field" style={{ marginTop: 17 }}><label htmlFor="movement-quantity">How many?</label><input id="movement-quantity" name="quantity" type="number" min="1" step="1" required autoFocus placeholder="Enter a quantity" data-testid="input-movement-quantity" /><span className="field-hint">{type === 'sold' ? 'This amount will be subtracted from stock.' : 'This amount will be added to stock.'}</span></div>
    {error && <div className="modal-error" role="alert" data-testid="status-mutation-error">{error}</div>}
    <div className="modal-footer"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy} data-testid="button-cancel-stock">Cancel</button><button className="button button-primary" type="submit" disabled={busy} data-testid="button-submit-stock">{busy ? 'Recording…' : 'Record movement'}</button></div>
  </form>;
}

function Router() {
  return <Switch><Route path="/" component={AppHome} /><Route component={NotFound} /></Switch>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Router /></RoutedErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
