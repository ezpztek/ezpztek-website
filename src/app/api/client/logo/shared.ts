import "server-only";

import {
  buildClientLogoObjectKey,
  isInventoryImageContentType,
  isSameOriginRequest,
  isUuid,
  type InventoryImageContentType,
} from "@/lib/inventory-images/core";
import { createAdminClient } from "@/lib/supabase/admin";

export const clientLogoColumns = [
  "logo_object_key",
  "logo_content_type",
  "logo_byte_size",
  "logo_checksum_sha256",
  "logo_etag",
  "logo_updated_at",
].join(",");

export type ClientLogoRow = {
  logo_object_key: string | null;
  logo_content_type: string | null;
  logo_byte_size: number | null;
  logo_checksum_sha256: string | null;
  logo_etag: string | null;
  logo_updated_at: string | null;
};

export function jsonError(error: string, message: string, status: number) {
  return Response.json(
    { error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function acceptsSameOriginMutation(request: Request) {
  return isSameOriginRequest(
    request.url,
    request.headers.get("origin"),
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  );
}

export async function readClientLogo(clientId: string) {
  return createAdminClient()
    .from("clients")
    .select(clientLogoColumns)
    .eq("id", clientId)
    .maybeSingle<ClientLogoRow>();
}

export function storedClientLogo(
  clientId: string,
  row: ClientLogoRow,
): {
  imageId: string;
  objectKey: string;
  contentType: InventoryImageContentType;
  byteSize: number;
  checksumSha256: string;
} | null {
  if (
    !row.logo_object_key ||
    !isInventoryImageContentType(row.logo_content_type) ||
    typeof row.logo_byte_size !== "number" ||
    !row.logo_checksum_sha256
  ) {
    return null;
  }

  const match = row.logo_object_key.match(
    /^clients\/([0-9a-f-]{36})\/branding\/([0-9a-f-]{36})\.(jpg|png|webp)$/i,
  );
  const imageId = match?.[2];
  if (!imageId || match?.[1]?.toLowerCase() !== clientId.toLowerCase() || !isUuid(imageId)) {
    return null;
  }
  const expectedKey = buildClientLogoObjectKey({
    clientId,
    imageId,
    contentType: row.logo_content_type,
  });
  if (expectedKey !== row.logo_object_key) return null;

  return {
    imageId,
    objectKey: expectedKey,
    contentType: row.logo_content_type,
    byteSize: Number(row.logo_byte_size),
    checksumSha256: row.logo_checksum_sha256,
  };
}

export function brandingUnavailableResponse() {
  return jsonError(
    "client_branding_unavailable",
    "Business logo settings are not ready yet. Apply migration 013 and try again.",
    503,
  );
}
