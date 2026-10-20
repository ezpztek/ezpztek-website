import "server-only";

import type { ClientSession } from "@/lib/client-auth";
import { getClientSession } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";

type ApiClientAuthorization =
  | { ok: true; client: ClientSession }
  | { ok: false; response: Response };

function errorResponse(error: string, message: string, status: number) {
  return Response.json(
    { error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function authorizeApiClient(
  moduleCode?: string,
): Promise<ApiClientAuthorization> {
  const client = await getClientSession();
  if (!client) {
    return {
      ok: false,
      response: errorResponse("unauthenticated", "Sign in to continue.", 401),
    };
  }
  if (client.status !== "approved") {
    return {
      ok: false,
      response: errorResponse(
        "access_unavailable",
        "Your client access is not currently approved.",
        403,
      ),
    };
  }
  if (!moduleCode) return { ok: true, client };

  const { data, error } = await createAdminClient()
    .from("client_module_access")
    .select("solution_modules!inner(code)")
    .eq("account_user_id", client.userId)
    .eq("solution_modules.code", moduleCode)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: errorResponse(
        "authorization_unavailable",
        "Access could not be verified. Please try again.",
        503,
      ),
    };
  }
  if (!data) {
    return {
      ok: false,
      response: errorResponse(
        "module_unavailable",
        "Inventory access is not enabled for this account.",
        403,
      ),
    };
  }
  return { ok: true, client };
}

export async function readSmallJson(request: Request, maximumBytes = 2048) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("JSON_REQUIRED");
  const advertisedLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) {
    throw new Error("BODY_TOO_LARGE");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new Error("BODY_TOO_LARGE");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}
