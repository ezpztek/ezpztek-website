import { authorizeApiClient } from "@/lib/api-client-auth";
import { inventoryImageReadUrl } from "@/lib/inventory-images/s3";
import {
  brandingUnavailableResponse,
  jsonError,
  readClientLogo,
  storedClientLogo,
} from "./shared";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Serve the current logo for the sidebar and summary using a private S3 redirect. */
export async function GET() {
  const authorization = await authorizeApiClient();
  if (!authorization.ok) return authorization.response;

  const { data: clientRow, error } = await readClientLogo(authorization.client.clientId);
  if (error) return brandingUnavailableResponse();
  if (!clientRow) return jsonError("client_not_found", "The client workspace was not found.", 404);

  const logo = storedClientLogo(authorization.client.clientId, clientRow);
  if (!logo) return jsonError("logo_not_found", "Logo not found.", 404);

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
