"use client";

import {
  inventoryImageContentTypes,
  MAX_INVENTORY_IMAGE_BYTES,
} from "@/lib/inventory-images/core";

const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
const RESIZE_THRESHOLD_BYTES = 1.2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;

type JsonResponse = {
  imageId?: string;
  message?: string;
  upload?: { url?: string; fields?: Record<string, string> };
};

async function responseJson(response: Response): Promise<JsonResponse> {
  try {
    return (await response.json()) as JsonResponse;
  } catch {
    return {};
  }
}

async function fileChecksumSha256(file: File) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
  );
  let binary = "";
  for (const value of digest) binary += String.fromCharCode(value);
  return btoa(binary);
}

function loadBrowserImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This photo could not be opened. Try a JPEG, PNG, or WebP image."));
    };
    image.src = objectUrl;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("This photo could not be prepared.")),
      "image/webp",
      quality,
    );
  });
}

/** Resize large phone photos before hashing and uploading to reduce wait time and storage. */
export async function prepareInventoryImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image from your gallery or camera.");
  }
  if (file.size < 1 || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("The original photo must be smaller than 25 MB.");
  }
  if (!inventoryImageContentTypes.includes(
    file.type as (typeof inventoryImageContentTypes)[number],
  )) {
    throw new Error("Use a JPEG, PNG, or WebP image. HEIC photos are not supported yet.");
  }

  const image = await loadBrowserImage(file);
  const largestDimension = Math.max(image.naturalWidth, image.naturalHeight);
  if (largestDimension <= MAX_IMAGE_DIMENSION && file.size <= RESIZE_THRESHOLD_BYTES) {
    return file;
  }

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / largestDimension);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot prepare the photo.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let blob = await canvasBlob(canvas, 0.82);
  if (blob.size > MAX_INVENTORY_IMAGE_BYTES) blob = await canvasBlob(canvas, 0.68);
  if (blob.size > MAX_INVENTORY_IMAGE_BYTES) {
    throw new Error("The optimized photo is still larger than 5 MB. Choose a smaller image.");
  }
  const baseName = file.name.replace(/\.[^.]+$/, "") || "inventory-photo";
  const outputType = blob.type === "image/webp" ? "image/webp" : "image/png";
  return new File([blob], `${baseName}.${outputType === "image/webp" ? "webp" : "png"}`, {
    type: outputType,
    lastModified: Date.now(),
  });
}

export async function uploadInventoryImage({
  file,
  productId,
  branchId,
  onStatus,
  alreadyPrepared = false,
}: {
  file: File;
  productId: string;
  branchId: string;
  onStatus?: (status: string) => void;
  alreadyPrepared?: boolean;
}) {
  if (!alreadyPrepared) onStatus?.("Optimizing photo…");
  const preparedFile = alreadyPrepared ? file : await prepareInventoryImage(file);
  if (!inventoryImageContentTypes.includes(
    preparedFile.type as (typeof inventoryImageContentTypes)[number],
  )) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }
  if (preparedFile.size < 1 || preparedFile.size > MAX_INVENTORY_IMAGE_BYTES) {
    throw new Error("Images must be between 1 byte and 5 MB.");
  }

  onStatus?.("Checking image…");
  const checksumSha256 = await fileChecksumSha256(preparedFile);
  onStatus?.("Preparing secure upload…");
  const intentResponse = await fetch("/api/inventory/images/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId,
      branchId,
      contentType: preparedFile.type,
      byteSize: preparedFile.size,
      checksumSha256,
    }),
  });
  const intent = await responseJson(intentResponse);
  if (!intentResponse.ok || !intent.imageId || !intent.upload?.url || !intent.upload.fields) {
    throw new Error(intent.message || "The secure upload could not be prepared.");
  }

  const uploadUrl = new URL(intent.upload.url);
  if (uploadUrl.protocol !== "https:") throw new Error("The upload destination is invalid.");

  onStatus?.("Uploading directly to AWS…");
  const uploadForm = new FormData();
  for (const [name, value] of Object.entries(intent.upload.fields)) {
    uploadForm.append(name, value);
  }
  uploadForm.append("file", preparedFile);
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    body: uploadForm,
    credentials: "omit",
  });
  if (!uploadResponse.ok) {
    throw new Error("AWS did not accept the upload. Check the bucket CORS setup and try again.");
  }

  onStatus?.("Verifying image…");
  let finalizeResponse = await fetch("/api/inventory/images/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageId: intent.imageId }),
  });
  if (finalizeResponse.status >= 500) {
    finalizeResponse = await fetch("/api/inventory/images/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: intent.imageId }),
    });
  }
  const finalized = await responseJson(finalizeResponse);
  if (!finalizeResponse.ok) {
    throw new Error(finalized.message || "The image could not be verified.");
  }
  onStatus?.("Image ready.");
  return { imageId: intent.imageId, optimized: preparedFile !== file };
}
