import { connection } from "next/server";
import { SubmitButton } from "@/components/admin/submit-button";
import { requireClientModule } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { adjustStockAction } from "../actions";

const movementLabels: Record<string, string> = {
  opening: "Opening stock",
  sale: "POS sale",
  receipt: "Stock received",
  adjustment_in: "Adjustment in",
  adjustment_out: "Adjustment out",
  damage: "Damaged / lost",
  return: "Customer return",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export default async function StockControlPage({
  searchParams,
}: {
  searchParams: Promise<{ adjusted?: string; error?: string }>;
}) {
  await connection();
  const { client } = await requireClientModule("stock-control");
  const params = await searchParams;
  const supabase = createAdminClient();
  const [productsResult, movementsResult] = await Promise.all([
    supabase
      .from("inventory_products")
      .select("id, sku, name, unit, stock_on_hand, reorder_level, is_active")
      .eq("client_id", client.clientId)
      .order("name"),
    supabase
      .from("inventory_stock_movements")
      .select("id, product_id, movement_type, quantity_change, balance_after, reference_type, reference_id, note, created_at, inventory_products!inner(name, sku, unit)")
      .eq("client_id", client.clientId)
      .order("created_at", { ascending: false })
      .limit(80),
  ]);
  const products = productsResult.data || [];
  const movements = movementsResult.data || [];
  const totalUnits = products.reduce((sum, product) => sum + product.stock_on_hand, 0);
  const lowStockCount = products.filter(
    (product) => product.is_active && product.stock_on_hand <= product.reorder_level,
  ).length;
  const errorMessages: Record<string, string> = {
    invalid: "Choose an item, movement type, and valid quantity.",
    stock: "That deduction is greater than the available stock. Nothing was changed.",
    save: "The stock movement could not be saved.",
  };

  return (
    <div className="business-module-page stock-page">
      <header className="business-module-head">
        <div><p className="client-kicker">Item stock control</p><h1>Every unit has a history.</h1><p>Receive deliveries, record adjustments, and trace every POS deduction in one immutable ledger.</p></div>
        <a className="client-module-action" href="#stock-entry">Record movement</a>
      </header>

      {params.adjusted && <div className="client-module-success"><strong>Stock updated.</strong><span>The new quantity is already reflected in Inventory and POS.</span></div>}
      {params.error && <div className="client-module-error">{errorMessages[params.error] || errorMessages.save}</div>}
      {(productsResult.error || movementsResult.error) && <div className="client-module-error">Stock data is unavailable. Run migration 202610070006 in Supabase.</div>}

      <section className="stock-summary-grid">
        <article><small>Total units</small><strong>{totalUnits.toLocaleString("en-PH")}</strong><span>Across {products.length} products</span></article>
        <article className={lowStockCount ? "warning" : ""}><small>Needs attention</small><strong>{lowStockCount}</strong><span>Low or out of stock</span></article>
        <article><small>Ledger entries</small><strong>{movements.length}</strong><span>Latest movement history</span></article>
      </section>

      <section className="stock-workspace">
        <div className="stock-ledger">
          <div className="client-section-heading"><div><p className="client-kicker">Audit trail</p><h2>Recent stock movements</h2></div><span>Newest first</span></div>
          <div className="stock-ledger-table">
            <div className="stock-ledger-head"><span>Item</span><span>Movement</span><span>Change</span><span>Balance</span><span>Date</span></div>
            {movements.map((movement) => {
              const product = Array.isArray(movement.inventory_products)
                ? movement.inventory_products[0]
                : movement.inventory_products;
              return (
                <article key={movement.id}>
                  <span><strong>{product?.name || "Item"}</strong><small>{product?.sku}</small></span>
                  <span><strong>{movementLabels[movement.movement_type] || movement.movement_type}</strong><small>{movement.note || movement.reference_id || "—"}</small></span>
                  <b className={movement.quantity_change > 0 ? "positive" : "negative"}>{movement.quantity_change > 0 ? "+" : ""}{movement.quantity_change}</b>
                  <span>{movement.balance_after} {product?.unit}</span>
                  <time>{formatDate(movement.created_at)}</time>
                </article>
              );
            })}
            {!movements.length && <div className="client-module-empty compact"><span>00</span><h2>No movements yet</h2><p>Add an opening stock or receive your first delivery.</p></div>}
          </div>
        </div>

        <aside className="stock-entry-card" id="stock-entry">
          <p className="client-kicker">Stock entry</p><h2>Record a movement</h2><p>Positive movements add stock. Sales are deducted automatically by POS.</p>
          <form action={adjustStockAction}>
            <label>Item<select name="productId" required defaultValue=""><option value="" disabled>Select an item</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock_on_hand} {product.unit}</option>)}</select></label>
            <label>Movement<select name="movementType" defaultValue="receipt"><option value="receipt">Receive delivery (+)</option><option value="adjustment_in">Manual adjustment (+)</option><option value="return">Customer return (+)</option><option value="adjustment_out">Manual adjustment (−)</option><option value="damage">Damaged / lost (−)</option></select></label>
            <label>Quantity<input name="quantity" type="number" min="1" step="1" required /></label>
            <label>Reason / reference<textarea name="note" rows={3} placeholder="Supplier delivery, count correction, damaged item…" /></label>
            <SubmitButton className="client-primary-button" pendingLabel="Updating stock…">Save stock movement</SubmitButton>
          </form>
          <div className="stock-rule-note"><strong>POS rule</strong><p>When balance reaches zero, the item disappears from the POS catalog automatically.</p></div>
        </aside>
      </section>
    </div>
  );
}
