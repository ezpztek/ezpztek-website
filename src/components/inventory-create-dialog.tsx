"use client";
/* eslint-disable @next/next/no-img-element -- blob previews cannot use the Next image optimizer */

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  createInventoryCategoryAction,
  createInventoryProductModalAction,
} from "@/app/portal/modules/actions";
import { inventoryUnits } from "@/lib/inventory/catalog";
import {
  prepareInventoryImage,
  uploadInventoryImage,
} from "@/lib/inventory-images/upload-client";

type InventoryCategory = { id: string; name: string };

export function InventoryCreateDialog({
  branchId,
  initialCategories,
  imageUploadEnabled,
}: {
  branchId: string;
  initialCategories: InventoryCategory[];
  imageUploadEnabled: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const galleryInputId = useId();
  const cameraInputId = useId();
  const previewUrlRef = useRef("");
  const photoSelectionTokenRef = useRef(0);
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [category, setCategory] = useState(initialCategories[0]?.name ?? "");
  const [categoryName, setCategoryName] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [photo, setPhoto] = useState<File>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => {
    photoSelectionTokenRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  function openDialog() {
    setError("");
    setStatus("");
    setCreated(false);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (busy || categoryBusy) return;
    dialogRef.current?.close();
    resetDialogState();
    triggerRef.current?.focus();
  }

  function resetDialogState() {
    formRef.current?.reset();
    setCategory(categories[0]?.name ?? "");
    setCategoryName("");
    clearPhoto();
    setCreated(false);
    setPhotoBusy(false);
    setStatus("");
    setError("");
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    const token = ++photoSelectionTokenRef.current;
    setError("");
    setStatus("Preparing photo…");
    setPhotoBusy(true);
    try {
      const preparedPhoto = await prepareInventoryImage(file);
      if (token !== photoSelectionTokenRef.current) return;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(preparedPhoto);
      setPreviewUrl(previewUrlRef.current);
      setPhoto(preparedPhoto);
      setStatus("Photo ready.");
    } catch (photoError) {
      if (token !== photoSelectionTokenRef.current) return;
      setStatus("");
      setError(photoError instanceof Error ? photoError.message : "This photo could not be prepared.");
    } finally {
      if (token === photoSelectionTokenRef.current) setPhotoBusy(false);
    }
  }

  function clearPhoto() {
    photoSelectionTokenRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
    setPhoto(undefined);
  }

  async function addCategory() {
    if (categoryBusy) return;
    setCategoryBusy(true);
    setError("");
    const form = new FormData();
    form.set("name", categoryName);
    try {
      const result = await createInventoryCategoryAction(form);
      if (!result.ok) {
        setError(result.message ?? "The category could not be added.");
        return;
      }
      const saved = result.category;
      setCategories((current) => current.some((item) => item.id === saved.id)
        ? current
        : [...current, saved].sort((left, right) => left.name.localeCompare(right.name)));
      setCategory(saved.name);
      setCategoryName("");
      setStatus(`${saved.name} is ready to use.`);
    } catch {
      setError("The category could not be added. Check your connection and try again.");
    } finally {
      setCategoryBusy(false);
    }
  }

  function handleCategoryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void addCategory();
    }
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || created || photoBusy) return;
    setBusy(true);
    setError("");
    setStatus("Saving item…");
    try {
      const result = await createInventoryProductModalAction(new FormData(event.currentTarget));
      if (!result.ok) {
        setError(result.message ?? "The item could not be saved.");
        setStatus("");
        return;
      }
      setCreated(true);
      if (photo && imageUploadEnabled) {
        try {
          await uploadInventoryImage({
            file: photo,
            productId: result.productId,
            branchId: result.branchId,
            onStatus: setStatus,
            alreadyPrepared: true,
          });
        } catch (uploadError) {
          setStatus("Item created successfully.");
          setError(`The item is saved, but its photo was not uploaded. ${
            uploadError instanceof Error ? uploadError.message : "Add it from the item details."
          }`);
          router.refresh();
          return;
        }
      }
      router.refresh();
      dialogRef.current?.close();
      resetDialogState();
      triggerRef.current?.focus();
    } catch {
      setStatus("");
      setError("The item could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="client-module-action" onClick={openDialog}>
        + New item
      </button>
      <dialog
        ref={dialogRef}
        className="inventory-create-dialog"
        aria-labelledby="inventory-create-title"
        aria-describedby="inventory-create-description"
        onCancel={(event) => {
          if (busy || categoryBusy) event.preventDefault();
          else closeDialog();
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <div className="inventory-dialog-shell">
          <header className="inventory-dialog-head">
            <div>
              <p className="client-kicker">New catalog item</p>
              <h2 id="inventory-create-title">Add an item</h2>
              <p id="inventory-create-description">Create the item, opening stock, and optional POS photo together.</p>
            </div>
            <button type="button" className="inventory-dialog-close" onClick={closeDialog} disabled={busy || categoryBusy} aria-label="Close new item dialog">×</button>
          </header>

          <div className="inventory-category-control">
            <div className="inventory-category-heading">
              <strong>Add a category</strong>
              <span>Create it here, then use it for this item.</span>
            </div>
            <div className="inventory-category-add">
              <label htmlFor="new-category-name">Category name</label>
              <div>
                <input
                  id="new-category-name"
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  onKeyDown={handleCategoryKeyDown}
                  minLength={2}
                  maxLength={80}
                  placeholder="e.g. Beverages"
                  disabled={busy || categoryBusy}
                />
                <button type="button" onClick={() => void addCategory()} disabled={busy || categoryBusy || categoryName.trim().length < 2}>
                  {categoryBusy && <span className="client-inline-spinner" aria-hidden="true" />}
                  {categoryBusy ? "Adding…" : "Add category"}
                </button>
              </div>
            </div>
          </div>

          <form ref={formRef} className="inventory-create-form" onSubmit={createItem} aria-busy={busy || categoryBusy || photoBusy}>
            <input type="hidden" name="branchId" value={branchId} />
            <label className="inventory-field-wide">Item name<input name="name" placeholder="Premium Rice 5kg" required minLength={2} maxLength={140} autoComplete="off" /></label>
            <div className="inventory-form-row">
              <label>SKU <small>Optional</small><input name="sku" placeholder="Auto-generated if blank" maxLength={60} autoComplete="off" /></label>
              <label>Barcode <small>Optional</small><input name="barcode" placeholder="Scan or type" maxLength={80} autoComplete="off" /></label>
            </div>
            <div className="inventory-form-row">
              <label>Category
                <select name="category" value={category} onChange={(event) => setCategory(event.target.value)} required disabled={!categories.length}>
                  {!categories.length && <option value="">Add a category first</option>}
                  {categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                </select>
              </label>
              <label>Unit
                <select name="unit" defaultValue="piece" required>
                  {inventoryUnits.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                </select>
              </label>
            </div>
            <div className="inventory-form-row">
              <label>Selling price<input name="salePrice" type="number" min="0" max="100000000" step="0.01" placeholder="0.00" inputMode="decimal" required /></label>
              <label>Unit cost<input name="cost" type="number" min="0" max="100000000" step="0.01" placeholder="0.00" inputMode="decimal" required /></label>
            </div>
            <div className="inventory-form-row">
              <label>Opening stock<input name="openingStock" type="number" min="0" max="10000000" step="1" defaultValue="0" inputMode="numeric" required /></label>
              <label>Reorder at<input name="reorderLevel" type="number" min="0" max="10000000" step="1" defaultValue="5" inputMode="numeric" required /></label>
            </div>

            <fieldset className="inventory-photo-picker" disabled={!imageUploadEnabled || busy || photoBusy}>
              <legend>Item photo <small>Optional</small></legend>
              <div className="inventory-photo-layout">
                <div className={`inventory-photo-preview ${previewUrl ? "has-image" : ""}`}>
                  {previewUrl ? <img src={previewUrl} alt="Selected item preview" /> : <span>No photo selected</span>}
                </div>
                <div className="inventory-photo-actions">
                  <label htmlFor={galleryInputId}>Upload photo</label>
                  <input id={galleryInputId} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
                  <label htmlFor={cameraInputId}>Open camera</label>
                  <input id={cameraInputId} type="file" accept="image/*" capture="environment" onChange={(event) => { void choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
                  {photo && <button type="button" onClick={clearPhoto}>Remove photo</button>}
                </div>
              </div>
              {!imageUploadEnabled && <p>Photo storage is unavailable until migration 010 and AWS are configured. You can still create the item.</p>}
            </fieldset>

            <div className={error ? "inventory-dialog-feedback error" : "inventory-dialog-feedback"} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-atomic="true">
              {status && <strong>{status}</strong>}
              {error && <span>{error}</span>}
            </div>
            <footer className="inventory-dialog-footer">
              <button type="button" className="inventory-dialog-cancel" onClick={closeDialog} disabled={busy || categoryBusy}>{created ? "Close" : "Cancel"}</button>
              {!created && <button type="submit" className="client-primary-button" disabled={busy || categoryBusy || photoBusy || !categories.length}>
                {(busy || photoBusy) && <span className="client-inline-spinner" aria-hidden="true" />}
                {busy ? status || "Creating item…" : photoBusy ? "Preparing photo…" : "Create item"}
              </button>}
            </footer>
          </form>
        </div>
      </dialog>
    </>
  );
}
