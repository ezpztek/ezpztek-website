import { connection } from "next/server";
import Link from "next/link";
import { requireClientModule } from "@/lib/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { money } from "@/lib/delivery/core";
import { sandboxEnabled } from "@/lib/delivery/server";
import { DeliveryRefresh } from "@/components/delivery-refresh";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  createBranchAction, requestConnectionAction, mapProductAction, simulateOrderAction,
  simulateStatusAction, retryEventAction, processPendingAction, disconnectAction, resolveInventoryAction,
} from "./actions";
import "./delivery.css";

export default async function IntegrationsPage({ searchParams }: {
  searchParams: Promise<{ notice?: string }>;
}) {
  await connection();
  const { client, moduleAccess } = await requireClientModule("pos");
  const { notice } = await searchParams;
  const db = createAdminClient();
  const [branchesResult, connectionsResult, mappingsResult, ordersResult, eventsResult, productsResult] = await Promise.all([
    db.from("client_branches").select("id,name,is_primary")
      .eq("client_id", client.clientId).eq("is_active", true).order("is_primary", { ascending: false }),
    db.from("delivery_connections").select("id,branch_id,environment,status,remote_store_id,vendor_code,chain_code")
      .eq("client_id", client.clientId).order("created_at", { ascending: false }).limit(100),
    db.from("delivery_product_mappings").select("connection_id,external_product_id,product_id")
      .eq("client_id", client.clientId).order("external_product_id").limit(1000),
    db.from("delivery_orders").select("id,connection_id,external_order_id,status,inventory_state,total_centavos,created_at")
      .eq("client_id", client.clientId).order("created_at", { ascending: false }).limit(50),
    db.from("delivery_events").select("id,external_order_id,status,attempts,last_error,received_at")
      .eq("client_id", client.clientId).in("status", ["pending", "retry", "dead"])
      .order("received_at", { ascending: false }).limit(50),
    db.from("inventory_products").select("id,branch_id,name,sku")
      .eq("client_id", client.clientId).eq("is_active", true).order("name").limit(1000),
  ]);
  if ([branchesResult, connectionsResult, mappingsResult, ordersResult, eventsResult, productsResult].some((result) => result.error)) {
    return <section className="delivery-workspace"><h1>Delivery integrations</h1>
      <div className="delivery-notice">Setup is incomplete. Apply migrations 007, 008 and 009 to a staging
        database first. No live foodpanda connection has been activated.</div></section>;
  }
  const branches = branchesResult.data || [];
  const connections = connectionsResult.data || [];
  const mappings = mappingsResult.data || [];
  const orders = ordersResult.data || [];
  const events = eventsResult.data || [];
  const products = productsResult.data || [];
  const messages: Record<string, string> = {
    branch_created: "Branch created. Add its inventory before mapping products.",
    sandbox_created: "Sandbox connected. Test orders cannot change real stock or sales.",
    approval_requested: "Request saved. EZPZTEK and foodpanda must verify this restaurant before activation.",
    mapped: "Product mapping saved. Retry any previously failed matching events.",
    simulated: "Test event saved and processing attempted. Check the order and recovery inbox below.",
    processed: "Pending events processed. Unresolved failures remain in the recovery inbox.",
    retried: "Event requeued and processing attempted.",
    disconnected: "Connection disconnected. Existing history is retained.",
    resolved: "Cancelled-stock review recorded with an audit entry.",
    connection_exists: "This branch already has a connection in that environment. Contact your administrator to reconnect.",
    full_access_required: "A full POS entitlement is required for a real restaurant integration request.",
    sandbox_disabled: "Sandbox disabled. Enable DELIVERY_SANDBOX_ENABLED only in your test environment.",
    mapping_failed: "Choose a product in the same business and branch as this connection.",
    failed: "The operation could not be confirmed. Check the recovery inbox and database configuration before retrying.",
    invalid: "Review the required fields and confirmations.",
  };
  return <div className="delivery-workspace">
    <header className="delivery-header">
      <div><p className="client-kicker">EZPZTEK / connected restaurants</p><h1>Delivery integrations</h1>
        <p>Restaurant onboarding, product mapping, and an order recovery inbox.</p></div>
      <span className="delivery-badge">Production adapter disabled</span>
    </header>
    <div className="delivery-notice"><strong>Preparation workspace, not a live foodpanda connection.</strong>
      The simulator uses an internal EZPZTEK format. Official restaurant API authentication, payload mapping,
      menu publication and provider testing are required before production activation.</div>
    {notice && <p role="status" className="delivery-notice">{messages[notice] || messages.invalid}</p>}
    <section className="delivery-stats">
      <article><small>Branches</small><strong>{branches.length}</strong></article>
      <article><small>Connections shown</small><strong>{connections.length}</strong></article>
      <article><small>Recent orders shown</small><strong>{orders.length}</strong></article>
      <article><small>Queued / failed shown</small><strong>{events.length}</strong></article>
    </section>
    <div className="delivery-columns">
      <section className="delivery-panel"><h2>Connect a restaurant</h2>
        <p>Your foodpanda account password is not requested. Real integrations begin as approval requests.</p>
        <form action={requestConnectionAction}>
          <label>Branch<select name="branchId" required>{branches.map((branch) =>
            <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
          <label>Environment<select name="environment" defaultValue={sandboxEnabled() ? "sandbox" : "staging"}>
            <option value="sandbox" disabled={!sandboxEnabled()}>EZPZTEK simulator</option>
            <option value="staging" disabled={moduleAccess.access_mode !== "full"}>Foodpanda staging request</option>
            <option value="production" disabled={moduleAccess.access_mode !== "full"}>Foodpanda production request</option>
          </select></label>
          <label>Foodpanda vendor code<input name="vendorCode" maxLength={120} placeholder="Required for real requests" /></label>
          <label>Foodpanda chain code<input name="chainCode" maxLength={120} placeholder="Required for real requests" /></label>
          <label className="delivery-check"><input type="checkbox" name="consent" required />
            I am authorized to request an integration for this restaurant.</label>
          <SubmitButton className="client-primary-button" pendingLabel="Saving...">Save request</SubmitButton>
        </form>
      </section>
      <section className="delivery-panel"><h2>Branch setup</h2>
        <p>Stock is branch-specific. Creating a branch does not copy or move existing inventory. This pilot supports up to 25 branches per client.</p>
        <div className="delivery-branch-list">{branches.map((branch) => <p key={branch.id}>
          <strong>{branch.name}</strong>{branch.is_primary && <small> / Primary</small>}
          <Link href={`/portal/modules/inventory?branch=${branch.id}`}>Open inventory</Link></p>)}</div>
        <form action={createBranchAction}><label>New branch name<input name="name" minLength={2} maxLength={100} required /></label>
          <SubmitButton className="client-module-action" pendingLabel="Creating...">Create branch</SubmitButton></form>
      </section>
    </div>
    <section><h2>Restaurant connections</h2>
      {!connections.length && <p>Start with a sandbox and one mapped product.</p>}
      {(products.length === 1000 || mappings.length === 1000) && <p className="delivery-notice">
        This pilot view caps products and mappings at 1,000 each. Add paginated search before onboarding larger catalogs.</p>}
      <div className="delivery-columns">{connections.map((conn) => {
        const ownMappings = mappings.filter((m) => m.connection_id === conn.id);
        const ownProducts = products.filter((p) => p.branch_id === conn.branch_id);
        return <article key={conn.id} className="delivery-panel">
          <div className="delivery-card-head"><h3>{branches.find((branch) => branch.id === conn.branch_id)?.name || "Branch"}</h3>
            <span className="delivery-badge">{conn.environment} / {conn.status}</span></div>
          <p>Remote store: <code>{conn.remote_store_id}</code></p><p>{ownMappings.length} mapped products shown</p>
          {conn.status !== "disconnected" && <form action={mapProductAction}>
            <input type="hidden" name="connectionId" value={conn.id} />
            <label>POS product<select name="productId" required>{ownProducts.map((p) =>
              <option key={p.id} value={p.id}>{p.name} / {p.sku}</option>)}</select></label>
            <label>External product or variant code<input name="externalProductId" maxLength={120} required /></label>
            <SubmitButton className="client-module-action" pendingLabel="Mapping...">Save mapping</SubmitButton>
          </form>}
          {ownMappings.length > 0 && <details><summary>View mappings</summary>{ownMappings.map((m) =>
            <p key={m.external_product_id}><code>{m.external_product_id}</code>{" / "}
              {products.find((p) => p.id === m.product_id)?.name || m.product_id}</p>)}</details>}
          {conn.environment === "sandbox" && conn.status === "active" && sandboxEnabled() && <form action={simulateOrderAction}>
            <input type="hidden" name="connectionId" value={conn.id} />
            <label>Test product<select name="externalProductId" required>{ownMappings.map((m) =>
              <option key={m.external_product_id}>{m.external_product_id}</option>)}</select></label>
            <SubmitButton className="client-primary-button" pendingLabel="Simulating...">Create sandbox order</SubmitButton>
          </form>}
          {conn.status !== "disconnected" && <details><summary>Disconnect</summary><form action={disconnectAction}>
            <input type="hidden" name="connectionId" value={conn.id} />
            <label className="delivery-check"><input type="checkbox" name="confirm" required />Stop new orders; retain history.</label>
            <SubmitButton className="client-module-action" pendingLabel="Disconnecting...">Disconnect restaurant</SubmitButton>
          </form></details>}
        </article>;
      })}</div>
    </section>
    <section className="delivery-panel">
      <div className="delivery-card-head"><h2>Latest 50 orders</h2><DeliveryRefresh /></div>
      <p>Sandbox and staging orders never deduct real stock, create POS receipts, or increase reported sales.</p>
      <div className="delivery-table-wrap"><table><thead><tr>
        <th>Order</th><th>Environment</th><th>Status</th><th>Merchandise total</th><th>Inventory</th><th>Action</th>
      </tr></thead><tbody>{orders.map((order) => {
        const conn = connections.find((item) => item.id === order.connection_id);
        return <tr key={order.id}>
          <td><code>{order.external_order_id}</code></td><td>{conn?.environment || "Unknown"}</td>
          <td>{order.status}</td><td>{money(Number(order.total_centavos))}</td><td>{order.inventory_state}</td>
          <td>{conn?.environment === "sandbox" && conn.status === "active" && sandboxEnabled()
            && !["cancelled", "rejected", "picked_up"].includes(order.status) && <form action={simulateStatusAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <select name="status" aria-label="Simulated status">
                <option value="accepted">Accepted</option><option value="preparing">Preparing</option>
                <option value="ready">Ready</option><option value="picked_up">Picked up</option>
                <option value="cancelled">Cancelled</option><option value="rejected">Rejected</option>
              </select><SubmitButton className="client-module-action" pendingLabel="Simulating...">Simulate status</SubmitButton>
            </form>}
            {order.inventory_state === "review" && moduleAccess.access_mode === "full" && <form action={resolveInventoryAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <select name="resolution" aria-label="Cancelled stock outcome">
                <option value="consumed">Prepared / consumed: do not restore</option>
                <option value="restocked">All items unused and returned: restore</option>
              </select>
              <label className="delivery-check"><input type="checkbox" name="confirm" required />
                I physically verified the inventory outcome for all items.</label>
              <SubmitButton className="client-module-action" pendingLabel="Recording...">Resolve inventory review</SubmitButton>
            </form>}
          </td>
        </tr>;
      })}</tbody></table></div>
      {!orders.length && <p>No delivery orders yet.</p>}
    </section>
    <section className="delivery-panel">
      <div className="delivery-card-head"><h2>Recovery inbox</h2><form action={processPendingAction}>
        <SubmitButton className="client-module-action" pendingLabel="Processing...">Process pending events</SubmitButton>
      </form></div>
      <p>Latest 50 pending, retrying, or stopped events. Five failed attempts stop automatic retries.
        Fix the mapping or stock issue before replaying an event.</p>
      {events.map((event) => <div className="delivery-event" key={event.id}>
        <div><strong>{event.external_order_id}</strong>
          <p>{event.status} / {event.attempts} attempts / {event.last_error || "Waiting for worker"}</p></div>
        {["retry", "dead"].includes(event.status) && <form action={retryEventAction}>
          <input type="hidden" name="eventId" value={event.id} />
          <SubmitButton className="client-module-action" pendingLabel="Retrying...">Retry event</SubmitButton>
        </form>}
      </div>)}
      {!events.length && <p>No pending failures in this view.</p>}
    </section>
  </div>;
}
