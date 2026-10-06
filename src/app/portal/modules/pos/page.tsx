import { connection } from "next/server";
import { PosRegister } from "@/components/pos-register";
import { requireClientModule } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export default async function PointOfSalePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; receipt?: string; total?: string; change?: string }>;
}) {
  await connection();
  const { client } = await requireClientModule("pos");
  const params = await searchParams;
  const supabase = createAdminClient();
  const manilaDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date());
  const manilaDayStart = new Date(`${manilaDate}T00:00:00+08:00`).toISOString();
  const [productsResult, salesResult] = await Promise.all([
    supabase
      .from("inventory_products")
      .select("id, sku, name, category, unit, sale_price_centavos, stock_on_hand")
      .eq("client_id", client.clientId)
      .eq("is_active", true)
      .gt("stock_on_hand", 0)
      .order("name"),
    supabase
      .from("pos_sales")
      .select("id, receipt_number, total_centavos, payment_method, created_at")
      .eq("client_id", client.clientId)
      .eq("status", "completed")
      .gte("created_at", manilaDayStart)
      .order("created_at", { ascending: false }),
  ]);
  const products = (productsResult.data || []).map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    unit: product.unit,
    salePriceCentavos: product.sale_price_centavos,
    stockOnHand: product.stock_on_hand,
  }));
  const sales = salesResult.data || [];
  const todayTotal = sales.reduce((sum, sale) => sum + sale.total_centavos, 0);
  const errorMessages: Record<string, string> = {
    cart: "Add at least one valid item before checkout.",
    stock: "Stock changed before checkout. The cart was not charged; review the available quantities.",
    payment: "Cash received is lower than the sale total.",
    checkout: "The sale could not be completed. No stock was deducted.",
  };

  return (
    <div className="business-module-page pos-page">
      <header className="business-module-head pos-head">
        <div><p className="client-kicker">Point of sale</p><h1>Sell fast. Stock stays accurate.</h1><p>Every completed sale deducts inventory automatically and records an audit trail.</p></div>
        <div className="pos-daily-summary"><span><small>Today’s sales</small><strong>{sales.length}</strong></span><span><small>Today’s revenue</small><strong>{peso.format(todayTotal / 100)}</strong></span></div>
      </header>

      {params.receipt && <div className="pos-receipt-banner"><div><p className="client-kicker">Sale completed</p><strong>{params.receipt}</strong><span>Total {peso.format(Number(params.total || 0) / 100)} · Change {peso.format(Number(params.change || 0) / 100)}</span></div><b>✓</b></div>}
      {params.error && <div className="client-module-error">{errorMessages[params.error] || errorMessages.checkout}</div>}
      {(productsResult.error || salesResult.error) && <div className="client-module-error">POS data is unavailable. Run migration 202610070006 in Supabase.</div>}

      <PosRegister products={products} />

      <section className="pos-recent-sales">
        <div className="client-section-heading"><div><p className="client-kicker">Today</p><h2>Recent receipts</h2></div><span>{sales.length} completed</span></div>
        <div>
          {sales.slice(0, 8).map((sale) => <article key={sale.id}><span><strong>{sale.receipt_number}</strong><small>{new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(sale.created_at))} · {sale.payment_method}</small></span><b>{peso.format(sale.total_centavos / 100)}</b></article>)}
          {!sales.length && <p>No completed sales today.</p>}
        </div>
      </section>
    </div>
  );
}
