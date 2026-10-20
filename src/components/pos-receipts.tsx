"use client";

import { useEffect, useRef, useState } from "react";

export type PosReceipt = {
  id: string;
  receiptNumber: string;
  subtotalCentavos: number;
  discountCentavos: number;
  totalCentavos: number;
  tenderedCentavos: number | null;
  changeCentavos: number;
  paymentMethod: string;
  source: string;
  createdAt: string;
  items: Array<{
    id: number;
    sku: string;
    productName: string;
    quantity: number;
    unitPriceCentavos: number;
    lineTotalCentavos: number;
  }>;
};

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const receiptDate = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

function paymentLabel(value: string) {
  if (value.toLowerCase() === "gcash") return "GCash";
  if (value.toLowerCase() === "pos") return "POS";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PosReceipts({
  receipts,
  initialReceiptNumber,
  businessName,
  branchName,
}: {
  receipts: PosReceipt[];
  initialReceiptNumber?: string;
  businessName: string;
  branchName: string;
}) {
  const initialReceipt = receipts.find((receipt) => receipt.receiptNumber === initialReceiptNumber) || null;
  const [activeReceipt, setActiveReceipt] = useState<PosReceipt | null>(() => initialReceipt);
  const [celebrate, setCelebrate] = useState(() => Boolean(initialReceipt));
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  function closeReceipt() {
    setActiveReceipt(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("receipt")) {
      url.searchParams.delete("receipt");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }

  function openReceipt(receipt: PosReceipt, opener: HTMLButtonElement) {
    openerRef.current = opener;
    setCelebrate(false);
    setActiveReceipt(receipt);
  }

  useEffect(() => {
    if (!activeReceipt) return;
    closeButtonRef.current?.focus();

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        closeReceipt();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeReceipt]);

  return (
    <>
      <section className="pos-recent-sales">
        <div className="client-section-heading">
          <div><p className="client-kicker">Receipts</p><h2>Order history</h2></div>
          <span>Latest {receipts.length} / {branchName}</span>
        </div>
        <div>
          {receipts.map((receipt) => (
            <article key={receipt.id}>
              <span>
                <strong>{receipt.receiptNumber}</strong>
                <small>{receiptDate.format(new Date(receipt.createdAt))} / {paymentLabel(receipt.source)} / {paymentLabel(receipt.paymentMethod)}</small>
              </span>
              <b>{peso.format(receipt.totalCentavos / 100)}</b>
              <button type="button" onClick={(event) => openReceipt(receipt, event.currentTarget)}>View receipt</button>
            </article>
          ))}
          {!receipts.length && <p>No completed receipts yet.</p>}
        </div>
      </section>

      {activeReceipt && (
        <div className="pos-receipt-layer" role="presentation">
          <button className="pos-receipt-backdrop" type="button" aria-label="Close receipt" onClick={closeReceipt} />
          <div ref={dialogRef} className="pos-receipt-modal" role="dialog" aria-modal="true" aria-labelledby="pos-receipt-title">
            <div className={`pos-receipt-success ${celebrate ? "is-celebrating" : ""}`} aria-hidden="true"><span>{celebrate ? "✓" : "#"}</span></div>
            <div className="pos-receipt-intro">
              <p className="client-kicker">{celebrate ? "Payment complete" : "Saved receipt"}</p>
              <h2 id="pos-receipt-title">{celebrate ? "Sale completed" : "Receipt details"}</h2>
              <p>{celebrate ? "Stock has been updated and the receipt is ready." : "View or reprint this completed order."}</p>
            </div>

            <div className="pos-receipt-paper">
              <header>
                <strong>{businessName}</strong>
                <span>{branchName}</span>
                <small>Official sales receipt</small>
              </header>
              <div className="pos-receipt-meta">
                <span><small>Receipt</small><b>{activeReceipt.receiptNumber}</b></span>
                <span><small>Date</small><b>{receiptDate.format(new Date(activeReceipt.createdAt))}</b></span>
              </div>
              <div className="pos-receipt-items">
                {activeReceipt.items.map((item) => (
                  <div key={item.id}>
                    <span><strong>{item.productName}</strong><small>{item.quantity} × {peso.format(item.unitPriceCentavos / 100)}</small></span>
                    <b>{peso.format(item.lineTotalCentavos / 100)}</b>
                  </div>
                ))}
              </div>
              <div className="pos-receipt-totals">
                <span><small>Subtotal</small><b>{peso.format(activeReceipt.subtotalCentavos / 100)}</b></span>
                {activeReceipt.discountCentavos > 0 && <span><small>Discount</small><b>−{peso.format(activeReceipt.discountCentavos / 100)}</b></span>}
                <span className="total"><strong>Total</strong><b>{peso.format(activeReceipt.totalCentavos / 100)}</b></span>
                <span><small>Payment / {paymentLabel(activeReceipt.paymentMethod)}</small><b>{activeReceipt.tenderedCentavos === null ? peso.format(activeReceipt.totalCentavos / 100) : peso.format(activeReceipt.tenderedCentavos / 100)}</b></span>
                {activeReceipt.changeCentavos > 0 && <span><small>Change</small><b>{peso.format(activeReceipt.changeCentavos / 100)}</b></span>}
              </div>
              <footer><strong>Thank you!</strong><small>Powered by EZPZTEK</small></footer>
            </div>

            <div className="pos-receipt-actions">
              <button ref={closeButtonRef} type="button" className="pos-receipt-secondary" onClick={closeReceipt}>Close</button>
              <button type="button" className="pos-receipt-print" onClick={() => window.print()}><span aria-hidden="true">▣</span> Print 58mm receipt</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
