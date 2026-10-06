export function getSupabaseAuthConfig() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) return null;

  return { url, publishableKey };
}

export function hasAdminConfiguration() {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_PUBLISHABLE_KEY &&
      process.env.SUPABASE_SECRET_KEY,
  );
}

export function hasEmergencyPinConfiguration() {
  return Boolean(
    hasAdminConfiguration() &&
      process.env.RATE_LIMIT_SECRET &&
      process.env.ADMIN_EMERGENCY_PIN_HASH,
  );
}
