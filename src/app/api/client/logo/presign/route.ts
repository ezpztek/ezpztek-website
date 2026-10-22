import { randomUUID } from "node:crypto";
import { authorizeApiClient, readSmallJson } from "@/lib/api-client-auth";
import {
  buildClientLogoObjectKey,
  parseClientLogoIntent,
} from "@/lib/inventory-images/core";
import {
  assertInventoryImageStorageConfigured,
  createInventoryImageUpload,
} from "@/lib/inventory-images/s3";
import {
  acceptsSameOriginMutation,
  brandingUnavailableResponse,
  jsonError,
  readClientLogo,
} from "../shared";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!acceptsSameOriginMutation(request)) {
    return jsonError("invalid_origin", "This upload request was not accepted.", 403);
  }

  const authorization = await authorizeApiClient();
  if (!authorization.ok) return authorization.response;

  let intent;
  try {
    intent = parseClientLogoIntent(await readSmallJson(request));
    assertInventoryImageStorageConfigured();
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_IMAGE_REQUEST";
    if (code === "S3_IMAGE_STORAGE_NOT_CONFIGURED") {
      return jsonError(
        "storage_not_configured",
        "Business logo storage has not been configured yet.",
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
      "invalid_logo",
      "Choose a JPEG, PNG, or WebP logo no larger than 5 MB.",
      400,
    );
  }

  const { data: clientRow, error: clientError } = await readClientLogo(
    authorization.client.clientId,
  );
  if (clientError) {
    console.error("Client logo migration check failed", { code: clientError.code });
    return brandingUnavailableResponse();
  }
  if (!clientRow) {
    return jsonError("client_not_found", "The client workspace was not found.", 404);
  }

  const imageId = randomUUID();
  const objectKey = buildClientLogoObjectKey({
    clientId: authorization.client.clientId,
    imageId,
    contentType: intent.contentType,
  });

  try {
    const upload = await createInventoryImageUpload({
      id: imageId,
      objectKey,
      contentType: intent.contentType,
      byteSize: intent.byteSize,
      checksumSha256: intent.checksumSha256,
    });
    return Response.json(
      { imageId, upload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const rawCode = error instanceof Error ? error.name : "UnknownError";
    const code = /^[A-Za-z][A-Za-z0-9]+$/.test(rawCode) ? rawCode : "UnknownError";
    console.error("Client logo presign failed", { code });
    return jsonError(
      "logo_storage_unavailable",
      `AWS could not prepare the logo upload (${code}). Please try again.`,
      503,
    );
  }
}
