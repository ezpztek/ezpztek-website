import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import Link from "next/link";
import { PosRegister } from "@/components/pos-register";
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
    db.from("pos_sales").select("id,receipt_number,total_centavos,change_centavos,payment_method,source,created_at")
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
  const summary = summaryResult.data?.[0];
  const receipt = sales.find((sale) => sale.receipt_number === params.receipt);
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
    {receipt && <div className="pos-receipt-banner"><strong>{receipt.receipt_number}</strong>
      <span>Total {money(Number(receipt.total_centavos))} / Change {money(Number(receipt.change_centavos))}</span></div>}
    {params.error && <p role="alert" className="client-module-error">{errors[params.error] || errors.checkout}
      {params.error === "retry" && <Link href={`/portal/modules/pos?branch=${branch.id}`}> Start a new sale</Link>}</p>}
    {(productsResult.error || salesResult.error || summaryResult.error) && <p className="client-module-error">
      POS data is unavailable. Verify migrations 007-009 and database connectivity.</p>}
    <PosRegister key={requestId} products={products} branchId={branch.id} checkoutRequestId={requestId} />
    {products.length === 1000 && <p>The register lists the first 1,000 available products.
      Larger catalogs require paginated product search before rollout.</p>}
    <section className="pos-recent-sales"><h2>Latest 20 receipts / {branch.name}</h2><div>
      {sales.map((sale) => <article key={sale.id}><span><strong>{sale.receipt_number}</strong>
        <small>{new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(sale.created_at))}
          {" / "}{sale.source}{" / "}{sale.payment_method}</small></span><b>{money(Number(sale.total_centavos))}</b></article>)}
      {!sales.length && <p>No completed receipts yet.</p>}
    </div></section>
  </div>;
}
