import { BranchSelector } from "@/components/branch-selector";
import { InventoryCategoryFilter } from "@/components/inventory-category-filter";
import { InventoryCreateDialog } from "@/components/inventory-create-dialog";
import { InventoryImageManager } from "@/components/inventory-image-manager";
import { ProductImage } from "@/components/product-image";
import { getClientBranch } from "@/lib/branches";
import { inventoryUnits, inventoryUnitValues, isGeneratedInventorySku } from "@/lib/inventory/catalog";
import { isInventoryImageStorageConfigured } from "@/lib/inventory-images/s3";
import { connection } from "next/server";
import { SubmitButton } from "@/components/admin/submit-button";
import { requireClientModule } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateInventoryProductAction } from "../actions";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export default async function InventoryManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; category?: string; created?: string; updated?: string; error?: string }>;
}) {
  await connection();
  const { client } = await requireClientModule("inventory");
  const params = await searchParams;
  const { branch, branches } = await getClientBranch(client.clientId, params.branch);
  const supabase = createAdminClient();
  const [productsResult, imagesResult, categoriesResult] = await Promise.all([
    supabase.from("inventory_products")
      .select("id, sku, barcode, name, category, unit, sale_price_centavos, cost_centavos, stock_on_hand, reorder_level, is_active, updated_at")
      .eq("client_id", client.clientId).eq("branch_id", branch.id)
      .order("name").limit(1000),
    supabase.from("inventory_product_images")
      .select("id, product_id, status, position, is_primary")
      .eq("client_id", client.clientId).eq("branch_id", branch.id)
      .in("status", ["pending", "ready", "deleting"])
      .order("position").limit(3000),
    supabase.from("inventory_categories")
      .select("id,name").eq("client_id", client.clientId).eq("is_active", true)
      .order("name").limit(500),
  ]);
  const { data, error } = productsResult;
  const { data: imageData, error: imageError } = imagesResult;
  const { data: categoryData, error: categoryError } = categoriesResult;
  const products = data || [];
  const categoryMap = new Map<string, { id: string; name: string }>();
  for (const item of categoryData || []) {
    categoryMap.set(item.name.trim().toLocaleLowerCase("en-PH"), item);
  }
  for (const product of products) {
    const name = product.category.trim();
    const key = name.toLocaleLowerCase("en-PH");
    if (name && !categoryMap.has(key)) categoryMap.set(key, { id: `legacy-${key}`, name });
  }
  const categories = Array.from(categoryMap.values())
    .sort((left, right) => left.name.localeCompare(right.name, "en-PH"));
  const requestedCategory = typeof params.category === "string"
    ? params.category.trim().toLocaleLowerCase("en-PH")
    : "";
  const selectedCategory = categories.find(
    (item) => item.name.trim().toLocaleLowerCase("en-PH") === requestedCategory,
  )?.name ?? "";
  const selectedCategoryKey = selectedCategory.toLocaleLowerCase("en-PH");
  const displayedProducts = selectedCategory
    ? products.filter(
      (product) => product.category.trim().toLocaleLowerCase("en-PH") === selectedCategoryKey,
    )
    : products;
  const imageUploadEnabled = !imageError && isInventoryImageStorageConfigured();
  type ProductImageRow = {
    id: string;
    productId: string;
    status: "pending" | "ready" | "deleting";
    position: number;
    isPrimary: boolean;
  };
  const imagesByProduct = new Map<string, ProductImageRow[]>();
  for (const image of imageData || []) {
    if (!(["pending", "ready", "deleting"] as const).includes(image.status)) continue;
    const normalized: ProductImageRow = {
      id: image.id,
      productId: image.product_id,
      status: image.status,
      position: Number(image.position),
      isPrimary: image.is_primary,
    };
    const current = imagesByProduct.get(normalized.productId) || [];
    current.push(normalized);
    imagesByProduct.set(normalized.productId, current);
  }
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
    category: "Choose a category from the list or add it first.",
    save: "The product could not be saved. Confirm the inventory migration is installed.",
  };

  return (
    <div className="business-module-page inventory-page">
      <header className="business-module-head">
        <div><p className="client-kicker">Inventory management</p><h1>Know exactly what you have.</h1><p>Maintain the product catalog, pricing, reorder points, and current inventory value.</p></div>
        <InventoryCreateDialog
          key={branch.id}
          branchId={branch.id}
          initialCategories={categories}
          imageUploadEnabled={imageUploadEnabled}
        />
      </header>
      <BranchSelector branches={branches} selected={branch.id} action="/portal/modules/inventory" />

      {(params.created || params.updated) && <div className="client-module-success"><strong>{params.created ? "Item created." : "Item updated."}</strong><span>POS and stock control now use the latest product details.</span></div>}
      {params.error && <div className="client-module-error">{errorMessages[params.error] || errorMessages.save}</div>}
      {error && <div className="client-module-error">Inventory data is unavailable. Verify migrations 006-009 and database connectivity.</div>}
      {imageError && <div className="client-module-error">Product images are offline. Apply migration 010 and configure private AWS S3 storage.</div>}
      {!imageError && !imageUploadEnabled && <div className="client-module-error">Product image upload is disabled until AWS_S3_INVENTORY_BUCKET is configured.</div>}
      {categoryError && <div className="client-module-error">Category management is offline. Apply migration 011 before adding a new item.</div>}

      {products.length === 1000 && <p className="client-module-error">Only the first 1,000 products are shown. These inventory summary figures cover loaded products only; add paginated catalog search before larger rollouts.</p>}
      <section className="inventory-metrics">
        <article><small>Active items</small><strong>{activeProducts.length}</strong><span>{products.length} total records</span></article>
        <article className={lowStock.length ? "warning" : ""}><small>Low / no stock</small><strong>{lowStock.length}</strong><span>At or below reorder level</span></article>
        <article><small>Inventory cost</small><strong>{peso.format(inventoryValue / 100)}</strong><span>Based on current quantity</span></article>
        <article className="dark"><small>Potential retail value</small><strong>{peso.format(retailValue / 100)}</strong><span>Before discounts</span></article>
      </section>

      <section className="inventory-workspace">
        <div className="inventory-list">
          <div className="client-section-heading"><div><p className="client-kicker">Product catalog</p><h2>{selectedCategory || "All items"}</h2></div><span>{displayedProducts.length} products</span></div>
          <InventoryCategoryFilter
            categories={categories.map((item) => item.name)}
            selectedCategory={selectedCategory}
            shownCount={displayedProducts.length}
            totalCount={products.length}
          />
          {displayedProducts.map((product) => {
            const productImages = imagesByProduct.get(product.id) || [];
            const coverImage = productImages.find((image) => image.status === "ready" && image.isPrimary)
              || productImages.find((image) => image.status === "ready");
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
                  <span className={`inventory-item-mark ${coverImage ? "has-image" : ""}`}>
                    {coverImage
                      ? <ProductImage imageId={coverImage.id} alt={`${product.name} product`} />
                      : product.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="inventory-product-name"><strong>{product.name}</strong><small>{isGeneratedInventorySku(product.sku) ? "No SKU" : product.sku} · {product.category}</small></span>
                  <span><small>Price</small><strong>{peso.format(product.sale_price_centavos / 100)}</strong></span>
                  <span><small>Available</small><strong>{product.stock_on_hand} {product.unit}</strong></span>
                  <span className={`inventory-stock-state ${stockState.toLowerCase().replaceAll(" ", "-")}`}>{stockState}</span>
                  <b>›</b>
                </summary>
                <form className="inventory-edit-form" action={updateInventoryProductAction}>
                  <input type="hidden" name="branchId" value={branch.id} />
                  <input type="hidden" name="productId" value={product.id} />
                  <label>Item name<input name="name" defaultValue={product.name} required /></label>
                  <label>SKU <small>Optional</small><input name="sku" defaultValue={isGeneratedInventorySku(product.sku) ? "" : product.sku} placeholder="Auto-generated if blank" /></label>
                  <label>Barcode<input name="barcode" defaultValue={product.barcode || ""} /></label>
                  <label>Category<select name="category" defaultValue={product.category} required>
                    {!categories.some((item) => item.name === product.category) && <option value={product.category}>{product.category}</option>}
                    {categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                  </select></label>
                  <label>Unit<select name="unit" defaultValue={product.unit} required>
                    {!inventoryUnitValues.includes(product.unit as (typeof inventoryUnitValues)[number]) && <option value={product.unit}>{product.unit} (legacy)</option>}
                    {inventoryUnits.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                  </select></label>
                  <label>Selling price<input name="salePrice" type="number" min="0" step="0.01" defaultValue={(product.sale_price_centavos / 100).toFixed(2)} required /></label>
                  <label>Unit cost<input name="cost" type="number" min="0" step="0.01" defaultValue={(product.cost_centavos / 100).toFixed(2)} required /></label>
                  <label>Reorder level<input name="reorderLevel" type="number" min="0" step="1" defaultValue={product.reorder_level} required /></label>
                  <label className="inventory-active-check"><input name="isActive" type="checkbox" defaultChecked={product.is_active} /> Available for selling</label>
                  <SubmitButton className="client-module-action" pendingLabel="Saving…">Save item</SubmitButton>
                </form>
                <InventoryImageManager
                  productId={product.id}
                  branchId={branch.id}
                  productName={product.name}
                  images={productImages}
                  enabled={imageUploadEnabled}
                />
              </details>
            );
          })}
          {!products.length && <div className="client-module-empty"><span>01</span><h2>Add your first item</h2><p>Products with positive stock automatically become available in POS.</p></div>}
          {!!products.length && !displayedProducts.length && <div className="client-module-empty compact"><span>0 items</span><h2>No items in this category</h2><p>Choose All categories above or assign an item to {selectedCategory}.</p></div>}
        </div>

      </section>
    </div>
  );
}
