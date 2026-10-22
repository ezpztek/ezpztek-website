import { authorizeApiClient } from "@/lib/api-client-auth";
import { isUuid } from "@/lib/inventory-images/core";
import {
  deleteInventoryImageObject,
  inventoryImageReadUrl,
} from "@/lib/inventory-images/s3";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  acceptsSameOriginMutation,
  brandingUnavailableResponse,
  jsonError,
  readClientLogo,
  storedClientLogo,
} from "../shared";

export const runtime = "nodejs";
export const maxDuration = 30;

type LogoRouteContext = { params: Promise<{ imageId: string }> };

export async function GET(_request: Request, context: LogoRouteContext) {
  const { imageId } = await context.params;
  if (!isUuid(imageId)) return jsonError("logo_not_found", "Logo not found.", 404);

  const authorization = await authorizeApiClient();
  if (!authorization.ok) return authorization.response;

  const { data: clientRow, error } = await readClientLogo(authorization.client.clientId);
  if (error) return brandingUnavailableResponse();
  if (!clientRow) return jsonError("client_not_found", "The client workspace was not found.", 404);

  const logo = storedClientLogo(authorization.client.clientId, clientRow);
  if (!logo || logo.imageId !== imageId) {
    return jsonError("logo_not_found", "Logo not found.", 404);
  }

  try {
    const location = await inventoryImageReadUrl(logo.objectKey);
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        "Cache-Control": "private, max-age=240",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError("logo_unavailable", "AWS logo storage is unavailable.", 503);
  }
}

export async function DELETE(request: Request, context: LogoRouteContext) {
  if (!acceptsSameOriginMutation(request)) {
    return jsonError("invalid_origin", "This delete request was not accepted.", 403);
  }

  const { imageId } = await context.params;
  if (!isUuid(imageId)) return jsonError("logo_not_found", "Logo not found.", 404);

  const authorization = await authorizeApiClient();
  if (!authorization.ok) return authorization.response;

  const { data: clientRow, error } = await readClientLogo(authorization.client.clientId);
  if (error) return brandingUnavailableResponse();
  if (!clientRow) return jsonError("client_not_found", "The client workspace was not found.", 404);

  const logo = storedClientLogo(authorization.client.clientId, clientRow);
  if (!logo || logo.imageId !== imageId) {
    return jsonError("logo_not_found", "Logo not found.", 404);
  }

  const { data: cleared, error: clearError } = await createAdminClient()
    .from("clients")
    .update({
      logo_object_key: null,
      logo_content_type: null,
      logo_byte_size: null,
      logo_checksum_sha256: null,
      logo_etag: null,
      logo_updated_at: null,
    })
    .eq("id", authorization.client.clientId)
    .eq("logo_object_key", logo.objectKey)
    .select("id")
    .maybeSingle();

  if (clearError) {
    console.error("Client logo metadata removal failed", { code: clearError.code });
    return brandingUnavailableResponse();
  }
  if (!cleared) {
    return jsonError(
      "logo_changed",
      "The business logo changed while it was being removed. Refresh and try again.",
      409,
    );
  }

  let cleanupPending = false;
  try {
    await deleteInventoryImageObject(logo.objectKey);
  } catch (deleteError) {
    cleanupPending = true;
    console.error("Client logo object removal failed", {
      code: deleteError instanceof Error ? deleteError.name : "UnknownError",
    });
  }

  return Response.json(
    { removed: true, cleanupPending },
    { headers: { "Cache-Control": "no-store" } },
  );
}
