export const MAX_INVENTORY_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_INVENTORY_IMAGES_PER_PRODUCT = 3;

export const inventoryImageContentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type InventoryImageContentType = (typeof inventoryImageContentTypes)[number];

export type InventoryImageIntent = {
  productId: string;
  branchId: string;
  contentType: InventoryImageContentType;
  byteSize: number;
  checksumSha256: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_IMAGE_REQUEST");
  }
  return value as Record<string, unknown>;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isInventoryImageContentType(
  value: unknown,
): value is InventoryImageContentType {
  return inventoryImageContentTypes.includes(value as InventoryImageContentType);
}

export function extensionForInventoryImage(contentType: InventoryImageContentType) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "webp";
}

export function parseInventoryImageIntent(input: unknown): InventoryImageIntent {
  const value = record(input);
  const allowed = ["productId", "branchId", "contentType", "byteSize", "checksumSha256"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("UNEXPECTED_IMAGE_FIELD");
  }
  if (!isUuid(value.productId) || !isUuid(value.branchId)) {
    throw new Error("INVALID_IMAGE_OWNER");
  }
  if (!isInventoryImageContentType(value.contentType)) {
    throw new Error("INVALID_IMAGE_TYPE");
  }
  if (
    typeof value.byteSize !== "number" ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 1 ||
    value.byteSize > MAX_INVENTORY_IMAGE_BYTES
  ) {
    throw new Error("INVALID_IMAGE_SIZE");
  }
  if (
    typeof value.checksumSha256 !== "string" ||
    !SHA256_BASE64_PATTERN.test(value.checksumSha256)
  ) {
    throw new Error("INVALID_IMAGE_CHECKSUM");
  }
  return {
    productId: value.productId,
    branchId: value.branchId,
    contentType: value.contentType,
    byteSize: value.byteSize,
    checksumSha256: value.checksumSha256,
  };
}

export function buildInventoryImageObjectKey({
  clientId,
  branchId,
  productId,
  imageId,
  contentType,
}: {
  clientId: string;
  branchId: string;
  productId: string;
  imageId: string;
  contentType: InventoryImageContentType;
}) {
  if (![clientId, branchId, productId, imageId].every(isUuid)) {
    throw new Error("INVALID_IMAGE_KEY_ID");
  }
  return `clients/${clientId}/branches/${branchId}/products/${productId}/${imageId}.${extensionForInventoryImage(contentType)}`;
}

export function hasExpectedImageSignature(
  contentType: InventoryImageContentType,
  bytes: Uint8Array,
) {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= png.length && png.every((value, index) => bytes[index] === value);
  }
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

export function isSameOriginRequest(
  requestUrl: string,
  origin: string | null,
  requestHost?: string | null,
  forwardedProtocol?: string | null,
) {
  if (!origin) return false;
  try {
    const parsedRequest = new URL(requestUrl);
    const parsedOrigin = new URL(origin);
    if (parsedRequest.origin === parsedOrigin.origin) return true;

    const host = requestHost?.split(",")[0].trim().toLowerCase();
    const protocol = (forwardedProtocol?.split(",")[0].trim().toLowerCase()
      || parsedRequest.protocol.replace(":", ""));
    return Boolean(
      host &&
      parsedOrigin.host.toLowerCase() === host &&
      parsedOrigin.protocol === `${protocol}:`,
    );
  } catch {
    return false;
  }
}
