import { authorizeApiClient, readSmallJson } from "@/lib/api-client-auth";
import {
  isInventoryImageContentType,
  isSameOriginRequest,
  isUuid,
} from "@/lib/inventory-images/core";
import {
  deleteInventoryImageObject,
  verifyInventoryImageUpload,
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

  let imageId: string;
  try {
    const body = await readSmallJson(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "imageId") ||
      !isUuid((body as Record<string, unknown>).imageId)
    ) {
      throw new Error("INVALID_IMAGE_ID");
    }
    imageId = (body as { imageId: string }).imageId;
  } catch {
    return jsonError("invalid_request", "The image confirmation is invalid.", 400);
  }

  const database = createAdminClient();
  const { data: image, error } = await database
    .from("inventory_product_images")
    .select("id, object_key, content_type, byte_size, checksum_sha256, status")
    .eq("id", imageId)
    .eq("client_id", authorization.client.clientId)
    .maybeSingle();

  if (error) {
    return jsonError(
      "image_storage_unavailable",
      "Image verification is unavailable. Verify migration 010 and try again.",
      503,
    );
  }
  if (!image) return jsonError("image_not_found", "The image reservation was not found.", 404);
  if (!(image.status === "pending" || image.status === "ready") ||
      !isInventoryImageContentType(image.content_type)) {
    return jsonError("image_not_finalizable", "This upload can no longer be confirmed.", 409);
  }

  let verification;
  try {
    verification = await verifyInventoryImageUpload({
      id: image.id,
      objectKey: image.object_key,
      contentType: image.content_type,
      byteSize: Number(image.byte_size),
      checksumSha256: image.checksum_sha256,
    });
  } catch (verificationError) {
    const code = verificationError instanceof Error ? verificationError.message : "";
    if (code.startsWith("S3_IMAGE_")) {
      if (image.status === "ready") {
        return jsonError(
          "ready_image_changed",
          "The stored image no longer matches its verified record. Contact EZPZTEK support.",
          409,
        );
      }
      let objectRemoved = false;
      try {
        await deleteInventoryImageObject(image.object_key);
        objectRemoved = true;
      } catch {
        // The metadata remains as a cleanup tombstone even if S3 is unavailable.
      }
      await database.rpc("fail_inventory_product_image", {
        p_client_id: authorization.client.clientId,
        p_image_id: image.id,
        p_failure_code: "UPLOAD_VALIDATION_FAILED",
      });
      if (!objectRemoved) {
        await database.rpc("begin_inventory_product_image_delete", {
          p_client_id: authorization.client.clientId,
          p_image_id: image.id,
        });
      }
      return jsonError(
        "upload_validation_failed",
        "The uploaded file did not match its declared image type, size, or checksum.",
        422,
      );
    }
    return jsonError(
      "image_verification_unavailable",
      "AWS could not confirm the upload yet. Please try again.",
      503,
    );
  }

  const { data: finalized, error: finalizeError } = await database.rpc(
    "finalize_inventory_product_image",
    {
      p_client_id: authorization.client.clientId,
      p_image_id: image.id,
      p_etag: verification.etag,
      p_uploaded_at: verification.uploadedAt.toISOString(),
    },
  );
  if (finalizeError || !finalized?.[0]) {
    if (finalizeError?.message.includes("IMAGE_UPLOAD_EXPIRED")) {
      if (image.status === "ready") {
        return jsonError(
          "ready_image_changed",
          "The stored image no longer matches its verified upload window. Contact EZPZTEK support.",
          409,
        );
      }
      let objectRemoved = false;
      try {
        await deleteInventoryImageObject(image.object_key);
        objectRemoved = true;
      } catch {
        // Failed rows can enter the retryable deletion lifecycle below.
      }
      await database.rpc("fail_inventory_product_image", {
        p_client_id: authorization.client.clientId,
        p_image_id: image.id,
        p_failure_code: "UPLOAD_EXPIRED",
      });
      if (!objectRemoved) {
        await database.rpc("begin_inventory_product_image_delete", {
          p_client_id: authorization.client.clientId,
          p_image_id: image.id,
        });
      }
      return jsonError(
        "upload_expired",
        "The upload expired before AWS confirmed it. Please choose the image again.",
        409,
      );
    }
    if (finalizeError?.message.includes("IMAGE_ETAG_CONFLICT")) {
      return jsonError(
        "image_version_conflict",
        "The stored image changed during confirmation. Please remove it and upload again.",
        409,
      );
    }
    return jsonError(
      "image_finalize_failed",
      "The upload reached AWS but could not be recorded. Please retry confirmation.",
      503,
    );
  }

  return Response.json(
    {
      imageId: finalized[0].image_id,
      status: "ready",
      isPrimary: finalized[0].image_is_primary,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
