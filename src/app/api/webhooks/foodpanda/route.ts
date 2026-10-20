export const runtime = "nodejs";
/** Fail closed until the approved Restaurant Plugin API adapter is built,
 * verified against vendor fixtures, and certified. This is NOT its final path.
 * Do not configure foodpanda production to call this placeholder endpoint. */
export function POST() {
  return Response.json({ error: "foodpanda_production_adapter_not_activated" }, {
    status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" },
  });
}
