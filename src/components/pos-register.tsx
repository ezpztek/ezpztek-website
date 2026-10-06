"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { completePosSaleAction } from "@/app/portal/modules/actions";

type PosProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  salePriceCentavos: number;
  stockOnHand: number;
};

type CartLine = PosProduct & { quantity: number };

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function CheckoutButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="pos-checkout-button" disabled={disabled || pending}>
      {pending ? "Completing sale…" : "Complete sale"}
    </button>
  );
}

export function PosRegister({ products }: { products: PosProduct[] }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cart, setCart] = useState<CartLine[]>([]);
  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category)))],
    [products],
  );
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [category, products, search]);
  const totalCentavos = cart.reduce(
    (total, line) => total + line.salePriceCentavos * line.quantity,
    0,
  );

  function addProduct(product: PosProduct) {
    setCart((current) => {
      const line = current.find((item) => item.id === product.id);
      if (line) {
        if (line.quantity >= product.stockOnHand) return current;
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...current, { ...product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, amount: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.id === productId
            ? {
                ...line,
                quantity: Math.min(line.stockOnHand, line.quantity + amount),
              }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  return (
    <div className="pos-register">
      <section className="pos-catalog">
        <div className="pos-search-row">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item or SKU…" aria-label="Search POS items" />
          <span>{products.length} available</span>
        </div>
        <div className="pos-categories">
          {categories.map((item) => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
        <div className="pos-product-grid">
          {visibleProducts.map((product) => {
            const cartQuantity = cart.find((line) => line.id === product.id)?.quantity || 0;
            return (
              <button type="button" className="pos-product-card" key={product.id} onClick={() => addProduct(product)} disabled={cartQuantity >= product.stockOnHand}>
                <span>{product.name.slice(0, 2).toUpperCase()}</span>
                <small>{product.category}</small>
                <strong>{product.name}</strong>
                <em>{product.sku}</em>
                <div><b>{peso.format(product.salePriceCentavos / 100)}</b><i>{product.stockOnHand} {product.unit}</i></div>
              </button>
            );
          })}
          {!visibleProducts.length && <div className="pos-no-products"><strong>No sellable items found</strong><p>Only active products with stock appear in POS.</p></div>}
        </div>
      </section>

      <aside className="pos-cart">
        <div className="pos-cart-head"><div><p className="client-kicker">Current sale</p><h2>Cart</h2></div><span>{cart.reduce((sum, line) => sum + line.quantity, 0)} items</span></div>
        <div className="pos-cart-lines">
          {cart.map((line) => (
            <div className="pos-cart-line" key={line.id}>
              <div><strong>{line.name}</strong><small>{peso.format(line.salePriceCentavos / 100)} each</small></div>
              <div className="pos-quantity"><button type="button" onClick={() => changeQuantity(line.id, -1)}>−</button><span>{line.quantity}</span><button type="button" onClick={() => changeQuantity(line.id, 1)} disabled={line.quantity >= line.stockOnHand}>+</button></div>
              <b>{peso.format((line.salePriceCentavos * line.quantity) / 100)}</b>
            </div>
          ))}
          {!cart.length && <div className="pos-empty-cart"><span>+</span><strong>Select an item to begin</strong><p>Out-of-stock products never appear here.</p></div>}
        </div>
        <form action={completePosSaleAction} className="pos-payment-form">
          <input type="hidden" name="cart" value={JSON.stringify(cart.map((line) => ({ productId: line.id, quantity: line.quantity })))} />
          <label>Payment method<select name="paymentMethod" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="gcash">GCash</option><option value="card">Card</option><option value="bank">Bank transfer</option></select></label>
          {paymentMethod === "cash" && <label>Cash received<input name="tenderedPesos" type="number" min={totalCentavos / 100} step="0.01" placeholder={peso.format(totalCentavos / 100)} required /></label>}
          <div className="pos-total-row"><span>Total</span><strong>{peso.format(totalCentavos / 100)}</strong></div>
          <CheckoutButton disabled={!cart.length} />
        </form>
      </aside>
    </div>
  );
}

