import { authorizeApiClient, readSmallJson } from "@/lib/api-client-auth";
import {
  buildInventoryImageObjectKey,
  isSameOriginRequest,
  parseInventoryImageIntent,
} from "@/lib/inventory-images/core";
import {
  assertInventoryImageStorageConfigured,
  createInventoryImageUpload,
} from "@/lib/inventory-images/s3";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function jsonError(error: string, message: string, status: number) {
  return Response.json(
    { error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(
    request.url,
    request.headers.get("origin"),
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  )) {
    return jsonError("invalid_origin", "This upload request was not accepted.", 403);
  }

  const authorization = await authorizeApiClient("inventory");
  if (!authorization.ok) return authorization.response;

  let intent;
  try {
    intent = parseInventoryImageIntent(await readSmallJson(request));
    assertInventoryImageStorageConfigured();
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_IMAGE_REQUEST";
    if (code === "S3_IMAGE_STORAGE_NOT_CONFIGURED") {
      return jsonError(
        "storage_not_configured",
        "Product image storage has not been configured yet.",
        503,
      );
    }
    if (code === "BODY_TOO_LARGE") {
      return jsonError("request_too_large", "The upload request is too large.", 413);
    }
    if (code === "JSON_REQUIRED") {
      return jsonError("json_required", "The upload request format is not supported.", 415);
    }
    return jsonError(
      "invalid_image",
      "Choose a JPEG, PNG, or WebP image no larger than 5 MB.",
      400,
    );
  }

  const database = createAdminClient();
  const { data, error } = await database.rpc("reserve_inventory_product_image", {
    p_client_id: authorization.client.clientId,
    p_branch_id: intent.branchId,
    p_product_id: intent.productId,
    p_actor_user_id: authorization.client.userId,
    p_content_type: intent.contentType,
    p_byte_size: intent.byteSize,
    p_checksum_sha256: intent.checksumSha256,
  });
  const reservation = data?.[0];

  if (error || !reservation) {
    const message = error?.message || "";
    if (message.includes("IMAGE_LIMIT_REACHED")) {
      return jsonError(
        "image_limit_reached",
        "This item already has three active image slots.",
        409,
      );
    }
    if (message.includes("PRODUCT_UNAVAILABLE")) {
      return jsonError("product_not_found", "That product is not available in this branch.", 404);
    }
    return jsonError(
      "image_storage_unavailable",
      "The image could not be reserved. Verify migration 010 and try again.",
      503,
    );
  }

  const expectedKey = buildInventoryImageObjectKey({
    clientId: authorization.client.clientId,
    branchId: intent.branchId,
    productId: intent.productId,
    imageId: reservation.image_id,
    contentType: intent.contentType,
  });
  if (reservation.image_object_key !== expectedKey) {
    await database.rpc("fail_inventory_product_image", {
      p_client_id: authorization.client.clientId,
      p_image_id: reservation.image_id,
      p_failure_code: "OBJECT_KEY_MISMATCH",
    });
    return jsonError("image_storage_error", "The image key could not be verified.", 500);
  }

  try {
    const upload = await createInventoryImageUpload({
      id: reservation.image_id,
      objectKey: reservation.image_object_key,
      contentType: intent.contentType,
      byteSize: intent.byteSize,
      checksumSha256: intent.checksumSha256,
    });
    return Response.json(
      {
        imageId: reservation.image_id,
        upload,
        expiresAt: reservation.image_upload_expires_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (presignError) {
    const rawCode = presignError instanceof Error ? presignError.name : "UnknownError";
    const diagnosticCode = /^[A-Za-z][A-Za-z0-9]+$/.test(rawCode)
      ? rawCode
      : "UnknownError";
    console.error("Inventory image presign failed", {
      code: diagnosticCode,
      region: process.env.AWS_REGION?.trim() || "missing",
      roleConfigured: Boolean(process.env.AWS_ROLE_ARN?.trim()),
    });
    await database.rpc("fail_inventory_product_image", {
      p_client_id: authorization.client.clientId,
      p_image_id: reservation.image_id,
      p_failure_code: "PRESIGN_FAILED",
    });
    return jsonError(
      "image_storage_unavailable",
      `AWS could not prepare the upload (${diagnosticCode}). Check the Vercel function logs.`,
      503,
    );
  }
}
