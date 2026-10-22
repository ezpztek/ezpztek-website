import { authorizeApiClient, readSmallJson } from "@/lib/api-client-auth";
import {
  buildClientLogoObjectKey,
  isUuid,
  parseClientLogoIntent,
} from "@/lib/inventory-images/core";
import {
  deleteInventoryImageObject,
  verifyInventoryImageUpload,
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

export async function POST(request: Request) {
  if (!acceptsSameOriginMutation(request)) {
    return jsonError("invalid_origin", "This upload request was not accepted.", 403);
  }

  const authorization = await authorizeApiClient();
  if (!authorization.ok) return authorization.response;

  let imageId: string;
  let intent;
  try {
    const body = await readSmallJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("INVALID_LOGO_CONFIRMATION");
    }
    const value = body as Record<string, unknown>;
    const allowed = ["imageId", "contentType", "byteSize", "checksumSha256"];
    if (Object.keys(value).some((key) => !allowed.includes(key)) || !isUuid(value.imageId)) {
      throw new Error("INVALID_LOGO_CONFIRMATION");
    }
    imageId = value.imageId;
    intent = parseClientLogoIntent({
      contentType: value.contentType,
      byteSize: value.byteSize,
      checksumSha256: value.checksumSha256,
    });
  } catch {
    return jsonError("invalid_request", "The logo confirmation is invalid.", 400);
  }

  const { data: clientRow, error: clientError } = await readClientLogo(
    authorization.client.clientId,
  );
  if (clientError) {
    console.error("Client logo metadata read failed", { code: clientError.code });
    return brandingUnavailableResponse();
  }
  if (!clientRow) {
    return jsonError("client_not_found", "The client workspace was not found.", 404);
  }

  const objectKey = buildClientLogoObjectKey({
    clientId: authorization.client.clientId,
    imageId,
    contentType: intent.contentType,
  });
  let verification;
  try {
    verification = await verifyInventoryImageUpload({
      id: imageId,
      objectKey,
      contentType: intent.contentType,
      byteSize: intent.byteSize,
      checksumSha256: intent.checksumSha256,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("S3_IMAGE_")) {
      try {
        await deleteInventoryImageObject(objectKey);
      } catch {
        // The unverified object stays private and can be removed by bucket cleanup.
      }
      return jsonError(
        "upload_validation_failed",
        "The uploaded file did not match its declared image type, size, or checksum.",
        422,
      );
    }
    return jsonError(
      "logo_verification_unavailable",
      "AWS could not confirm the logo upload yet. Please try again.",
      503,
    );
  }

  const oldLogo = storedClientLogo(authorization.client.clientId, clientRow);
  const database = createAdminClient();
  let updateQuery = database
    .from("clients")
    .update({
      logo_object_key: objectKey,
      logo_content_type: intent.contentType,
      logo_byte_size: intent.byteSize,
      logo_checksum_sha256: intent.checksumSha256,
      logo_etag: verification.etag,
      logo_updated_at: verification.uploadedAt.toISOString(),
    })
    .eq("id", authorization.client.clientId);
  updateQuery = oldLogo
    ? updateQuery.eq("logo_object_key", oldLogo.objectKey)
    : updateQuery.is("logo_object_key", null);
  const { data: updated, error: updateError } = await updateQuery
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    console.error("Client logo metadata update failed", { code: updateError?.code || "NO_ROW" });
    try {
      await deleteInventoryImageObject(objectKey);
    } catch {
      // The uploaded object is private; a lifecycle cleanup can remove this orphan.
    }
    if (!updateError) {
      return jsonError(
        "logo_changed",
        "The business logo changed during this upload. Refresh and try again.",
        409,
      );
    }
    return brandingUnavailableResponse();
  }

  let cleanupPending = false;
  if (oldLogo && oldLogo.objectKey !== objectKey) {
    try {
      await deleteInventoryImageObject(oldLogo.objectKey);
    } catch (error) {
      cleanupPending = true;
      console.error("Previous client logo cleanup failed", {
        code: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return Response.json(
    { imageId, status: "ready", cleanupPending },
    { headers: { "Cache-Control": "no-store" } },
  );
}
