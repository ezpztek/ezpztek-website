"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { completePosSaleAction } from "@/app/portal/modules/actions";
import { ProductImage } from "@/components/product-image";
import { isGeneratedInventorySku } from "@/lib/inventory/catalog";

type PosProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  salePriceCentavos: number;
  stockOnHand: number;
  imageId?: string;
};

type CartLine = PosProduct & { quantity: number };

const INITIAL_RESULT_LIMIT = 48;
const RESULT_STEP = 48;
const ALL_CATEGORY_FILTER = "";
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function CheckoutButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="pos-checkout-button" disabled={disabled || pending}>
      {pending && <span className="client-inline-spinner" aria-hidden="true" />}
      {pending ? "Completing sale…" : "Complete sale"}
    </button>
  );
}

export function PosRegister({
  products,
  branchId,
  checkoutRequestId,
}: {
  products: PosProduct[];
  branchId: string;
  checkoutRequestId: string;
}) {
  const [requestId] = useState(checkoutRequestId);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState(ALL_CATEGORY_FILTER);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [resultLimit, setResultLimit] = useState(INITIAL_RESULT_LIMIT);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const mobileCartTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCartCloseRef = useRef<HTMLButtonElement>(null);
  const mobileCartPanelRef = useRef<HTMLElement>(null);

  const categories = useMemo(() => {
    const categoryCounts = new Map<string, { label: string; count: number }>();

    products.forEach((product) => {
      const label = product.category.trim() || "Uncategorized";
      const value = label.toLocaleLowerCase("en-PH");
      const current = categoryCounts.get(value);
      categoryCounts.set(value, { label: current?.label || label, count: (current?.count || 0) + 1 });
    });

    return [
      { value: ALL_CATEGORY_FILTER, label: "All items", count: products.length },
      ...Array.from(categoryCounts, ([value, item]) => ({ value, ...item }))
        .sort((a, b) => a.label.localeCompare(b.label, "en-PH")),
    ];
  }, [products]);

  const activeCategory = category === ALL_CATEGORY_FILTER
    || categories.some((item) => item.value === category)
    ? category
    : ALL_CATEGORY_FILTER;

  useEffect(() => {
    if (category === activeCategory) return;
    const resetTimer = window.setTimeout(() => {
      setCategory(ALL_CATEGORY_FILTER);
      setResultLimit(INITIAL_RESULT_LIMIT);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [activeCategory, category]);

  const matchingProducts = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return products.filter((product) => {
      const productCategory = (product.category.trim() || "Uncategorized").toLocaleLowerCase("en-PH");
      const matchesCategory = activeCategory === ALL_CATEGORY_FILTER || productCategory === activeCategory;
      const matchesSearch = !query
        || product.name.toLowerCase().includes(query)
        || product.sku.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, deferredSearch, products]);
  const visibleProducts = matchingProducts.slice(0, resultLimit);
  const cartQuantityByProduct = useMemo(
    () => new Map(cart.map((line) => [line.id, line.quantity])),
    [cart],
  );
  const itemCount = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0),
    [cart],
  );
  const totalCentavos = useMemo(
    () => cart.reduce((total, line) => total + line.salePriceCentavos * line.quantity, 0),
    [cart],
  );

  useEffect(() => {
    if (!mobileCartOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileCartCloseRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileCartOpen(false);
        mobileCartTriggerRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(mobileCartPanelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? []).filter((element) => element.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileCartOpen]);

  function closeMobileCart() {
    setMobileCartOpen(false);
    window.requestAnimationFrame(() => mobileCartTriggerRef.current?.focus());
  }

  function addProduct(product: PosProduct) {
    setCart((current) => {
      const line = current.find((item) => item.id === product.id);
      if (line) {
        if (line.quantity >= Math.min(product.stockOnHand, 10000)) return current;
        return current.map((item) => item.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item);
      }
      return current.length >= 50 ? current : [...current, { ...product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, amount: number) {
    setCart((current) => current
      .map((line) => line.id === productId
        ? { ...line, quantity: Math.min(line.stockOnHand, 10000, line.quantity + amount) }
        : line)
      .filter((line) => line.quantity > 0));
  }

  return (
    <div className="pos-register">
      <section className="pos-catalog" inert={mobileCartOpen} aria-hidden={mobileCartOpen || undefined}>
        <div className="pos-search-row">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setResultLimit(INITIAL_RESULT_LIMIT);
            }}
            placeholder="Search item or SKU…"
            aria-label="Search POS items"
            type="search"
          />
          <span aria-live="polite">{matchingProducts.length} available</span>
        </div>
        <nav className="pos-categories" aria-label="Filter products by category">
          {categories.map((item) => (
            <button
              type="button"
              key={item.value ? `category:${item.value}` : "all-items"}
              className={category === item.value ? "active" : ""}
              aria-pressed={category === item.value}
              onClick={() => {
                setCategory(item.value);
                setResultLimit(INITIAL_RESULT_LIMIT);
              }}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </nav>
        <div className="pos-product-grid" aria-busy={search !== deferredSearch}>
          {visibleProducts.map((product) => {
            const cartQuantity = cartQuantityByProduct.get(product.id) || 0;
            return (
              <button
                type="button"
                className="pos-product-card"
                key={product.id}
                onClick={() => addProduct(product)}
                disabled={cartQuantity >= product.stockOnHand}
                aria-label={`Add ${product.name} to cart. ${product.stockOnHand} ${product.unit} available.`}
              >
                <span className={`pos-product-media ${product.imageId ? "has-image" : ""}`}>
                  {product.imageId
                    ? <ProductImage imageId={product.imageId} alt={`${product.name} product`} />
                    : <b aria-hidden="true">{product.name.slice(0, 2).toUpperCase()}</b>}
                </span>
                <small>{product.category}</small>
                <strong>{product.name}</strong>
                {!isGeneratedInventorySku(product.sku) && <em>{product.sku}</em>}
                <div><b>{peso.format(product.salePriceCentavos / 100)}</b><i>{product.stockOnHand} {product.unit}</i></div>
                {cartQuantity > 0 && <mark>{cartQuantity} in cart</mark>}
              </button>
            );
          })}
          {!matchingProducts.length && (
            <div className="pos-no-products"><strong>No sellable items found</strong><p>Only active products with stock appear in POS.</p></div>
          )}
        </div>
        {visibleProducts.length < matchingProducts.length && (
          <button className="pos-load-more" type="button" onClick={() => setResultLimit((current) => current + RESULT_STEP)}>
            Load more items <span>{visibleProducts.length} of {matchingProducts.length}</span>
          </button>
        )}
      </section>

      {mobileCartOpen && (
        <button type="button" className="pos-mobile-cart-backdrop" onClick={closeMobileCart} aria-label="Close cart" />
      )}
      <aside
        ref={mobileCartPanelRef}
        id="pos-cart-panel"
        className={`pos-cart ${mobileCartOpen ? "mobile-open" : ""}`}
        aria-label="Current sale cart"
        role={mobileCartOpen ? "dialog" : undefined}
        aria-modal={mobileCartOpen || undefined}
      >
        <div className="pos-cart-head">
          <div><p className="client-kicker">Current sale</p><h2>Cart</h2></div>
          <span aria-live="polite">{itemCount} {itemCount === 1 ? "item" : "items"}</span>
          <button ref={mobileCartCloseRef} type="button" className="pos-mobile-cart-close" onClick={closeMobileCart} aria-label="Close cart">×</button>
        </div>
        <div className="pos-cart-lines">
          {cart.map((line) => (
            <div className="pos-cart-line" key={line.id}>
              <div><strong>{line.name}</strong><small>{peso.format(line.salePriceCentavos / 100)} each</small></div>
              <div className="pos-quantity">
                <button type="button" onClick={() => changeQuantity(line.id, -1)} aria-label={`Remove one ${line.name}`}>−</button>
                <span aria-label={`${line.quantity} in cart`}>{line.quantity}</span>
                <button type="button" onClick={() => changeQuantity(line.id, 1)} disabled={line.quantity >= line.stockOnHand} aria-label={`Add one ${line.name}`}>+</button>
              </div>
              <b>{peso.format((line.salePriceCentavos * line.quantity) / 100)}</b>
            </div>
          ))}
          {!cart.length && <div className="pos-empty-cart"><span>+</span><strong>Select an item to begin</strong><p>Out-of-stock products never appear here.</p></div>}
        </div>
        <form action={completePosSaleAction} className="pos-payment-form">
          <input type="hidden" name="branchId" value={branchId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="cart" value={JSON.stringify(cart.map((line) => ({ productId: line.id, quantity: line.quantity })))} />
          <label>Payment method<select name="paymentMethod" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="gcash">GCash</option><option value="card">Card</option><option value="bank">Bank transfer</option></select></label>
          {paymentMethod === "cash" && <label>Cash received<input name="tenderedPesos" type="number" min={totalCentavos / 100} step="0.01" placeholder={peso.format(totalCentavos / 100)} inputMode="decimal" required /></label>}
          <div className="pos-total-row"><span>Total</span><strong>{peso.format(totalCentavos / 100)}</strong></div>
          <CheckoutButton disabled={!cart.length} />
          <small>Stock and prices are rechecked securely before the sale is completed.</small>
        </form>
      </aside>

      <button
        ref={mobileCartTriggerRef}
        type="button"
        className="pos-mobile-cart-toggle"
        onClick={() => setMobileCartOpen(true)}
        aria-controls="pos-cart-panel"
        aria-expanded={mobileCartOpen}
      >
        <span>View cart · {itemCount} {itemCount === 1 ? "item" : "items"}</span>
        <strong>{peso.format(totalCentavos / 100)}</strong>
      </button>
    </div>
  );
}
