import type { Metadata } from "next";
import { ClientSettingsForm } from "@/components/client-settings-form";
import { requireClient } from "@/lib/client-auth";
import { isInventoryImageStorageConfigured } from "@/lib/inventory-images/s3";
import {
  readClientLogo,
  storedClientLogo,
} from "@/app/api/client/logo/shared";

export const metadata: Metadata = {
  title: "Settings | Client workspace",
  description: "Manage your EZPZTEK workspace identity and account security.",
};

export default async function ClientSettingsPage() {
  const client = await requireClient();
  const { data: clientRow, error } = await readClientLogo(client.clientId);
  if (error) {
    console.error("Client settings branding read failed", { code: error.code });
  }
  const logo = clientRow ? storedClientLogo(client.clientId, clientRow) : null;
  const brandingAvailable = !error && Boolean(clientRow);

  return (
    <div className="client-module-page client-settings-page">
      <header>
        <div>
          <p className="client-kicker">Client settings</p>
          <h1>Settings</h1>
          <p>Manage your business logo and account password.</p>
        </div>
        <span className="client-live-badge"><i /> Secure workspace</span>
      </header>

      <ClientSettingsForm
        businessName={client.businessName}
        email={client.email}
        initialLogoId={logo?.imageId || null}
        brandingAvailable={brandingAvailable}
        storageAvailable={isInventoryImageStorageConfigured()}
      />
    </div>
  );
}
