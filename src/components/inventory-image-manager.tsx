"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImage } from "@/components/product-image";
import { MAX_INVENTORY_IMAGES_PER_PRODUCT } from "@/lib/inventory-images/core";
import { uploadInventoryImage } from "@/lib/inventory-images/upload-client";

type ProductImageRecord = {
  id: string;
  status: "pending" | "ready" | "deleting";
  position: number;
  isPrimary: boolean;
};

async function responseJson(response: Response): Promise<{ message?: string }> {
  try {
    return (await response.json()) as { message?: string };
  } catch {
    return {};
  }
}

export function InventoryImageManager({
  productId,
  branchId,
  productName,
  images,
  enabled,
}: {
  productId: string;
  branchId: string;
  productName: string;
  images: ProductImageRecord[];
  enabled: boolean;
}) {
  const inputId = useId();
  const cameraInputId = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const activeImages = images.filter((image) => image.status !== "deleting");
  const slotLimitReached = images.length >= MAX_INVENTORY_IMAGES_PER_PRODUCT;
  const controlsDisabled = busy || slotLimitReached || !enabled;

  async function upload(file: File) {
    setError("");
    setBusy(true);
    try {
      await uploadInventoryImage({ file, productId, branchId, onStatus: setStatus });
      router.refresh();
    } catch (uploadError) {
      setStatus("");
      setError(uploadError instanceof Error ? uploadError.message : "The upload failed.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(imageId: string) {
    if (!window.confirm("Remove this product image?")) return;
    setBusy(true);
    setError("");
    setStatus("Removing image…");
    try {
      const response = await fetch(`/api/inventory/images/${encodeURIComponent(imageId)}`, {
        method: "DELETE",
      });
      const result = await responseJson(response);
      if (!response.ok) throw new Error(result.message || "The image could not be removed.");
      setStatus("Image removed.");
      router.refresh();
    } catch (deleteError) {
      setStatus("");
      setError(deleteError instanceof Error ? deleteError.message : "The image could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  function selectFile(file: File | undefined) {
    if (file) void upload(file);
  }

  return (
    <section className="inventory-image-manager" aria-labelledby={`${inputId}-title`}>
      <div className="inventory-image-head">
        <div>
          <strong id={`${inputId}-title`}>Product images</strong>
          <small>Private in AWS S3 · {images.length}/{MAX_INVENTORY_IMAGES_PER_PRODUCT} slots</small>
        </div>
        <div className="inventory-image-actions">
          <label className={`inventory-image-upload ${controlsDisabled ? "disabled" : ""}`} htmlFor={inputId}>
            {busy && <span className="client-inline-spinner dark" aria-hidden="true" />}
            {busy ? "Working…" : "Upload photo"}
          </label>
          <label className={`inventory-image-upload camera ${controlsDisabled ? "disabled" : ""}`} htmlFor={cameraInputId}>
            Open camera
          </label>
        </div>
        <input
          id={inputId}
          className="inventory-image-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={controlsDisabled}
          onChange={(event) => {
            selectFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <input
          id={cameraInputId}
          className="inventory-image-input"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={controlsDisabled}
          onChange={(event) => {
            selectFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      <div className="inventory-image-grid">
        {images.map((image) => (
          <article className={`inventory-image-tile ${image.status}`} key={image.id}>
            {image.status === "ready" ? (
              <ProductImage imageId={image.id} alt={`${productName} product`} />
            ) : (
              <span>{image.status === "pending" ? "Upload incomplete" : "Removal pending"}</span>
            )}
            <div>
              <small>{image.isPrimary ? "Cover image" : image.status === "ready" ? `Image ${image.position}` : image.status}</small>
              <button type="button" disabled={busy} onClick={() => void remove(image.id)}>
                {image.status === "deleting" ? "Retry remove" : "Remove"}
              </button>
            </div>
          </article>
        ))}
        {!images.length && (
          <p className="inventory-image-empty">Add up to three clear item photos. The first becomes the POS cover.</p>
        )}
      </div>

      {!enabled && <p className="inventory-image-note">Apply migration 010 and configure AWS before uploading.</p>}
      {slotLimitReached && <p className="inventory-image-note">Remove an image before adding another.</p>}
      {(status || error) && (
        <p className={error ? "inventory-image-feedback error" : "inventory-image-feedback"} aria-live="polite">
          {error || status}
        </p>
      )}
      <small className="inventory-image-safety">JPEG, PNG, or WebP · optimized on your device · 5 MB maximum</small>
      {activeImages.length !== images.length && (
        <small className="inventory-image-safety">An interrupted removal remains retryable here.</small>
      )}
    </section>
  );
}
