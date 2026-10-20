/** Internal EZPZTEK contract. This is NOT a foodpanda request schema. */
export const deliveryStatuses = [
  "received", "accepted", "preparing", "ready", "picked_up", "cancelled", "rejected",
] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];
export type DeliveryItem = {
  externalProductId: string;
  name: string;
  quantity: number;
  unitPriceCentavos: number;
};
export type DeliverySnapshot = {
  currency: "PHP";
  subtotalCentavos: number;
  discountCentavos: number;
  totalCentavos: number;
  collection: "platform" | "merchant" | "unknown";
  items: DeliveryItem[];
};
export type DeliveryEvent = {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  remoteStoreId: string;
  orderId: string;
  status: DeliveryStatus;
  order?: DeliverySnapshot;
};
const MONEY_LIMIT = 1_000_000_000_000;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_OBJECT");
  }
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("UNEXPECTED_FIELD");
  }
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error("INVALID_TEXT");
  }
  return value.trim();
}
function integer(value: unknown, max = MONEY_LIMIT): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error("INVALID_INTEGER");
  }
  return value;
}
export function parseDeliveryEvent(input: unknown): DeliveryEvent {
  const event = object(input);
  onlyKeys(event, ["schemaVersion", "eventId", "occurredAt", "remoteStoreId", "orderId", "status", "order"]);
  if (event.schemaVersion !== 1) throw new Error("UNSUPPORTED_SCHEMA");
  const timestamp = text(event.occurredAt, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp)) {
    throw new Error("INVALID_TIMESTAMP");
  }
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 19) !== timestamp.slice(0, 19)) {
    throw new Error("INVALID_TIMESTAMP");
  }
  if (!deliveryStatuses.includes(event.status as DeliveryStatus)) throw new Error("INVALID_STATUS");
  const result: DeliveryEvent = {
    schemaVersion: 1,
    eventId: text(event.eventId, 120),
    occurredAt: instant.toISOString(),
    remoteStoreId: text(event.remoteStoreId, 120),
    orderId: text(event.orderId, 120),
    status: event.status as DeliveryStatus,
  };
  if (event.order !== undefined) {
    const order = object(event.order);
    onlyKeys(order, ["currency", "subtotalCentavos", "discountCentavos", "totalCentavos", "collection", "items"]);
    if (order.currency !== "PHP") throw new Error("UNSUPPORTED_CURRENCY");
    if (!["platform", "merchant", "unknown"].includes(String(order.collection))) throw new Error("INVALID_COLLECTION");
    if (!Array.isArray(order.items) || !order.items.length || order.items.length > 50) throw new Error("INVALID_ITEMS");
    const items = order.items.map((value): DeliveryItem => {
      const item = object(value);
      onlyKeys(item, ["externalProductId", "name", "quantity", "unitPriceCentavos"]);
      const quantity = integer(item.quantity, 10_000);
      if (quantity < 1) throw new Error("INVALID_QUANTITY");
      return {
        externalProductId: text(item.externalProductId, 120),
        name: text(item.name, 140),
        quantity,
        unitPriceCentavos: integer(item.unitPriceCentavos),
      };
    });
    const subtotalCentavos = integer(order.subtotalCentavos);
    const discountCentavos = integer(order.discountCentavos);
    const totalCentavos = integer(order.totalCentavos);
    const computed = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCentavos, 0);
    if (!Number.isSafeInteger(computed) || computed !== subtotalCentavos || discountCentavos > subtotalCentavos || subtotalCentavos - discountCentavos !== totalCentavos) {
      throw new Error("TOTAL_MISMATCH");
    }
    result.order = {
      currency: "PHP", subtotalCentavos, discountCentavos, totalCentavos,
      collection: order.collection as DeliverySnapshot["collection"], items,
    };
  }
  if (result.status === "received" && !result.order) throw new Error("MISSING_ORDER");
  return result;
}
/** The SQL processor implements the same monotonic state rules. */
export function nextDeliveryStatus(
  current: DeliveryStatus, incoming: DeliveryStatus, currentTime: string, incomingTime: string,
): DeliveryStatus {
  if (current === "picked_up" && (incoming === "cancelled" || incoming === "rejected")) {
    throw new Error("REFUND_REVIEW_REQUIRED");
  }
  if (["cancelled", "rejected", "picked_up"].includes(current)) return current;
  if (Date.parse(incomingTime) < Date.parse(currentTime)) return current;
  if (incoming === "cancelled" || incoming === "rejected") return incoming;
  return deliveryStatuses.indexOf(incoming) >= deliveryStatuses.indexOf(current) ? incoming : current;
}
export function money(centavos: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(centavos / 100);
}
