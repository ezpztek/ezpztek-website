import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import Link from "next/link";
import { PosRegister } from "@/components/pos-register";
import { PosReceipts, type PosReceipt } from "@/components/pos-receipts";
import { BranchSelector } from "@/components/branch-selector";
import { requireClientModule } from "@/lib/client-auth";
import { getClientBranch } from "@/lib/branches";
import { createAdminClient } from "@/lib/supabase/admin";
import { money } from "@/lib/delivery/core";
export default async function PointOfSalePage({ searchParams }: {
  searchParams: Promise<{ branch?: string; error?: string; receipt?: string; requestId?: string }>;
}) {
  await connection();
  const { client } = await requireClientModule("pos");
  const params = await searchParams;
  const { branch, branches } = await getClientBranch(client.clientId, params.branch);
  const db = createAdminClient();
  const [productsResult, salesResult, summaryResult, imagesResult] = await Promise.all([
    db.from("inventory_products").select("id,sku,name,category,unit,sale_price_centavos,stock_on_hand")
      .eq("client_id", client.clientId).eq("branch_id", branch.id).eq("is_active", true)
      .gt("stock_on_hand", 0).order("name").order("id").limit(1000),
    db.from("pos_sales").select("id,receipt_number,subtotal_centavos,discount_centavos,total_centavos,tendered_centavos,change_centavos,payment_method,source,created_at")
      .eq("client_id", client.clientId).eq("branch_id", branch.id).eq("status", "completed")
      .order("created_at", { ascending: false }).order("id").limit(20),
    db.rpc("get_branch_pos_summary", { p_client_id: client.clientId, p_branch_id: branch.id }),
    db.from("inventory_product_images").select("id,product_id")
      .eq("client_id", client.clientId).eq("branch_id", branch.id)
      .eq("status", "ready").eq("is_primary", true).limit(1000),
  ]);
  const coverImages = new Map<string, string>();
  for (const image of imagesResult.data || []) {
    coverImages.set(image.product_id, image.id);
  }
  const products = (productsResult.data || []).map((p) => ({
    id: p.id, sku: p.sku, name: p.name, category: p.category, unit: p.unit,
    salePriceCentavos: Number(p.sale_price_centavos), stockOnHand: p.stock_on_hand,
    imageId: coverImages.get(p.id),
  }));
  const sales = salesResult.data || [];
  const saleIds = sales.map((sale) => sale.id);
  const saleItemsResult = saleIds.length
    ? await db.from("pos_sale_items")
      .select("id,sale_id,sku,product_name,quantity,unit_price_centavos,line_total_centavos")
      .eq("client_id", client.clientId).eq("branch_id", branch.id).in("sale_id", saleIds)
      .order("id")
    : null;
  const saleItems = (saleItemsResult?.data || []) as Array<{
    id: number; sale_id: string; sku: string; product_name: string; quantity: number;
    unit_price_centavos: number; line_total_centavos: number;
  }>;
  const saleItemsError = saleItemsResult?.error;
  const itemsBySale = new Map<string, typeof saleItems>();
  for (const item of saleItems) {
    const items = itemsBySale.get(item.sale_id) || [];
    items.push(item);
    itemsBySale.set(item.sale_id, items);
  }
  const receipts: PosReceipt[] = sales.map((sale) => ({
    id: sale.id,
    receiptNumber: sale.receipt_number,
    subtotalCentavos: Number(sale.subtotal_centavos),
    discountCentavos: Number(sale.discount_centavos),
    totalCentavos: Number(sale.total_centavos),
    tenderedCentavos: sale.tendered_centavos === null ? null : Number(sale.tendered_centavos),
    changeCentavos: Number(sale.change_centavos),
    paymentMethod: sale.payment_method,
    source: sale.source,
    createdAt: sale.created_at,
    items: (itemsBySale.get(sale.id) || []).map((item) => ({
      id: Number(item.id),
      sku: item.sku,
      productName: item.product_name,
      quantity: Number(item.quantity),
      unitPriceCentavos: Number(item.unit_price_centavos),
      lineTotalCentavos: Number(item.line_total_centavos),
    })),
  }));
  const summary = summaryResult.data?.[0];
  const requestId = params.requestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.requestId)
    ? params.requestId : randomUUID();
  const errors: Record<string, string> = {
    cart: "Review the cart and try again.",
    stock: "Stock changed before checkout. No partial sale was committed.",
    payment: "Cash received is below the current total.",
    retry: "This request already belongs to another sale. Review recent receipts, then start a new sale.",
    checkout: "Checkout was not confirmed. Review recent receipts before retrying. The same request ID cannot create another sale.",
  };
  return <div className="business-module-page pos-page">
    <header className="business-module-head pos-head">
      <div><p className="client-kicker">EZPZTEK POS / {branch.name}</p>
        <h1>Sell fast. Keep stock accurate.</h1><p>Branch-isolated checkout with duplicate-request protection.</p>
        <Link href="/portal/modules/integrations">Delivery orders and integrations</Link>
      </div>
      <div className="pos-daily-summary">
        <span><small>Today / completed sales</small><strong>{summary?.sale_count ?? "--"}</strong></span>
        <span><small>Today / merchandise total</small><strong>{summary ? money(Number(summary.total_centavos)) : "--"}</strong></span>
      </div>
    </header>
    <BranchSelector branches={branches} selected={branch.id} action="/portal/modules/pos" />
    {params.error && <p role="alert" className="client-module-error">{errors[params.error] || errors.checkout}
      {params.error === "retry" && <Link href={`/portal/modules/pos?branch=${branch.id}`}> Start a new sale</Link>}</p>}
    {(productsResult.error || salesResult.error || summaryResult.error || saleItemsError) && <p className="client-module-error">
      POS data is unavailable. Verify migrations 007-009 and database connectivity.</p>}
    <PosRegister key={requestId} products={products} branchId={branch.id} checkoutRequestId={requestId} />
    {products.length === 1000 && <p>The register lists the first 1,000 available products.
      Larger catalogs require paginated product search before rollout.</p>}
    <PosReceipts key={params.receipt || "receipt-history"} receipts={receipts} initialReceiptNumber={params.receipt}
      businessName={client.businessName} branchName={branch.name} />
  </div>;
}
