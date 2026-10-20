import { verifyWorkerToken } from "@/lib/delivery/security";
import { processEvents } from "@/lib/delivery/server";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  if (!verifyWorkerToken(request.headers.get("authorization"), process.env.DELIVERY_WORKER_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json({ processed: await processEvents() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "worker_unavailable" }, { status: 503 });
  }
}
