import { authorizeApiClient } from "@/lib/api-client-auth";
import { isSameOriginRequest, isUuid } from "@/lib/inventory-images/core";
import {
  deleteInventoryImageObject,
  inventoryImageReadUrl,
} from "@/lib/inventory-images/s3";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

type ImageRouteContext = { params: Promise<{ imageId: string }> };

function jsonError(error: string, message: string, status: number) {
  return Response.json(
    { error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(_request: Request, context: ImageRouteContext) {
  const { imageId } = await context.params;
  if (!isUuid(imageId)) return jsonError("image_not_found", "Image not found.", 404);

  const authorization = await authorizeApiClient();
  if (!authorization.ok) return authorization.response;
  const { data: image, error } = await createAdminClient()
    .from("inventory_product_images")
    .select("object_key")
    .eq("id", imageId)
    .eq("client_id", authorization.client.clientId)
    .eq("status", "ready")
    .maybeSingle();

  if (error) return jsonError("image_unavailable", "Image metadata is unavailable.", 503);
  if (!image) return jsonError("image_not_found", "Image not found.", 404);
  try {
    const location = await inventoryImageReadUrl(image.object_key);
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        // Keep authorization private while avoiding a database + STS round trip on every rerender.
        // The cache lifetime remains shorter than the five-minute signed S3 URL.
        "Cache-Control": "private, max-age=240",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError("image_unavailable", "AWS image storage is unavailable.", 503);
  }
}

export async function DELETE(request: Request, context: ImageRouteContext) {
  if (!isSameOriginRequest(
    request.url,
    request.headers.get("origin"),
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  )) {
    return jsonError("invalid_origin", "This delete request was not accepted.", 403);
  }
  const { imageId } = await context.params;
  if (!isUuid(imageId)) return jsonError("image_not_found", "Image not found.", 404);

  const authorization = await authorizeApiClient("inventory");
  if (!authorization.ok) return authorization.response;
  const database = createAdminClient();
  const { data, error } = await database.rpc("begin_inventory_product_image_delete", {
    p_client_id: authorization.client.clientId,
    p_image_id: imageId,
  });
  const deletion = data?.[0];
  if (error || !deletion) {
    const status = error?.message?.includes("IMAGE_NOT_FOUND") ? 404 : 503;
    return jsonError(
      status === 404 ? "image_not_found" : "image_delete_unavailable",
      status === 404 ? "Image not found." : "The image could not be prepared for deletion.",
      status,
    );
  }
  if (deletion.image_status === "deleted") {
    return Response.json({ imageId, status: "deleted" }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    await deleteInventoryImageObject(deletion.image_object_key);
  } catch {
    return jsonError(
      "image_delete_retry_required",
      "AWS did not confirm deletion. Keep this page open and try Remove again.",
      503,
    );
  }

  const { data: completed, error: completionError } = await database.rpc(
    "complete_inventory_product_image_delete",
    {
      p_client_id: authorization.client.clientId,
      p_image_id: imageId,
    },
  );
  if (completionError || completed !== true) {
    return jsonError(
      "image_delete_retry_required",
      "The file was removed but its record still needs cleanup. Try Remove again.",
      503,
    );
  }
  return Response.json(
    { imageId, status: "deleted" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
