import { connection } from "next/server";
import { SubmitButton } from "@/components/admin/submit-button";
import { requireClientModule } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createInventoryProductAction,
  updateInventoryProductAction,
} from "../actions";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export default async function InventoryManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; updated?: string; error?: string }>;
}) {
  await connection();
  const { client } = await requireClientModule("inventory");
  const params = await searchParams;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("inventory_products")
    .select("id, sku, barcode, name, category, unit, sale_price_centavos, cost_centavos, stock_on_hand, reorder_level, is_active, updated_at")
    .eq("client_id", client.clientId)
    .order("name");
  const products = data || [];
  const activeProducts = products.filter((product) => product.is_active);
  const lowStock = activeProducts.filter(
    (product) => product.stock_on_hand <= product.reorder_level,
  );
  const inventoryValue = products.reduce(
    (total, product) => total + product.stock_on_hand * product.cost_centavos,
    0,
  );
  const retailValue = products.reduce(
    (total, product) => total + product.stock_on_hand * product.sale_price_centavos,
    0,
  );

  const errorMessages: Record<string, string> = {
    invalid: "Check the product details and try again.",
    duplicate: "That SKU or barcode is already used by another item.",
    save: "The product could not be saved. Confirm the inventory migration is installed.",
  };

  return (
    <div className="business-module-page inventory-page">
      <header className="business-module-head">
        <div><p className="client-kicker">Inventory management</p><h1>Know exactly what you have.</h1><p>Maintain the product catalog, pricing, reorder points, and current inventory value.</p></div>
        <a className="client-module-action" href="#new-item">+ New item</a>
      </header>

      {(params.created || params.updated) && <div className="client-module-success"><strong>{params.created ? "Item created." : "Item updated."}</strong><span>POS and stock control now use the latest product details.</span></div>}
      {params.error && <div className="client-module-error">{errorMessages[params.error] || errorMessages.save}</div>}
      {error && <div className="client-module-error">Inventory data is unavailable. Run migration 202610070006 in Supabase.</div>}

      <section className="inventory-metrics">
        <article><small>Active items</small><strong>{activeProducts.length}</strong><span>{products.length} total records</span></article>
        <article className={lowStock.length ? "warning" : ""}><small>Low / no stock</small><strong>{lowStock.length}</strong><span>At or below reorder level</span></article>
        <article><small>Inventory cost</small><strong>{peso.format(inventoryValue / 100)}</strong><span>Based on current quantity</span></article>
        <article className="dark"><small>Potential retail value</small><strong>{peso.format(retailValue / 100)}</strong><span>Before discounts</span></article>
      </section>

      <section className="inventory-workspace">
        <div className="inventory-list">
          <div className="client-section-heading"><div><p className="client-kicker">Product catalog</p><h2>All items</h2></div><span>{products.length} products</span></div>
          {products.map((product) => {
            const stockState = !product.is_active
              ? "Inactive"
              : product.stock_on_hand === 0
                ? "Out of stock"
                : product.stock_on_hand <= product.reorder_level
                  ? "Low stock"
                  : "In stock";
            return (
              <details className="inventory-product-card" key={product.id}>
                <summary>
                  <span className="inventory-item-mark">{product.name.slice(0, 2).toUpperCase()}</span>
                  <span className="inventory-product-name"><strong>{product.name}</strong><small>{product.sku} · {product.category}</small></span>
                  <span><small>Price</small><strong>{peso.format(product.sale_price_centavos / 100)}</strong></span>
                  <span><small>Available</small><strong>{product.stock_on_hand} {product.unit}</strong></span>
                  <span className={`inventory-stock-state ${stockState.toLowerCase().replaceAll(" ", "-")}`}>{stockState}</span>
                  <b>›</b>
                </summary>
                <form className="inventory-edit-form" action={updateInventoryProductAction}>
                  <input type="hidden" name="productId" value={product.id} />
                  <label>Item name<input name="name" defaultValue={product.name} required /></label>
                  <label>SKU<input name="sku" defaultValue={product.sku} required /></label>
                  <label>Barcode<input name="barcode" defaultValue={product.barcode || ""} /></label>
                  <label>Category<input name="category" defaultValue={product.category} required /></label>
                  <label>Unit<input name="unit" defaultValue={product.unit} required /></label>
                  <label>Selling price<input name="salePrice" type="number" min="0" step="0.01" defaultValue={(product.sale_price_centavos / 100).toFixed(2)} required /></label>
                  <label>Unit cost<input name="cost" type="number" min="0" step="0.01" defaultValue={(product.cost_centavos / 100).toFixed(2)} required /></label>
                  <label>Reorder level<input name="reorderLevel" type="number" min="0" step="1" defaultValue={product.reorder_level} required /></label>
                  <label className="inventory-active-check"><input name="isActive" type="checkbox" defaultChecked={product.is_active} /> Available for selling</label>
                  <SubmitButton className="client-module-action" pendingLabel="Saving…">Save item</SubmitButton>
                </form>
              </details>
            );
          })}
          {!products.length && <div className="client-module-empty"><span>01</span><h2>Add your first item</h2><p>Products with positive stock automatically become available in POS.</p></div>}
        </div>

        <aside className="inventory-new-item" id="new-item">
          <p className="client-kicker">New catalog item</p><h2>Add an item</h2><p>Opening stock creates the first entry in the stock ledger.</p>
          <form action={createInventoryProductAction}>
            <label>Item name<input name="name" placeholder="Premium Rice 5kg" required /></label>
            <div className="inventory-form-row"><label>SKU<input name="sku" placeholder="RICE-5KG" required /></label><label>Barcode<input name="barcode" placeholder="Optional" /></label></div>
            <div className="inventory-form-row"><label>Category<input name="category" defaultValue="General" required /></label><label>Unit<input name="unit" defaultValue="pc" required /></label></div>
            <div className="inventory-form-row"><label>Selling price<input name="salePrice" type="number" min="0" step="0.01" placeholder="0.00" required /></label><label>Unit cost<input name="cost" type="number" min="0" step="0.01" placeholder="0.00" required /></label></div>
            <div className="inventory-form-row"><label>Opening stock<input name="openingStock" type="number" min="0" step="1" defaultValue="0" required /></label><label>Reorder at<input name="reorderLevel" type="number" min="0" step="1" defaultValue="5" required /></label></div>
            <SubmitButton className="client-primary-button" pendingLabel="Creating item…">Create item</SubmitButton>
          </form>
        </aside>
      </section>
    </div>
  );
}
