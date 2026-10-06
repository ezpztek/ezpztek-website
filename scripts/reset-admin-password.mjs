import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local.");
  process.exit(1);
}

if (!process.stdin.isTTY) {
  console.error("Run this command in an interactive terminal.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const { data: owners, error: ownersError } = await supabase
  .from("admin_users")
  .select("user_id, display_name")
  .eq("role", "owner")
  .eq("is_active", true);

if (ownersError) {
  console.error(`Unable to find the active owner: ${ownersError.message}`);
  process.exit(1);
}

if (owners.length !== 1) {
  console.error(
    `Expected exactly one active owner, but found ${owners.length}. No password was changed.`,
  );
  process.exit(1);
}

let muted = false;
const hiddenOutput = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) {
      process.stdout.write(chunk, encoding);
    }
    callback();
  },
});
const prompt = createInterface({
  input: process.stdin,
  output: hiddenOutput,
  terminal: true,
});

async function askForSecret(label) {
  process.stdout.write(label);
  muted = true;
  try {
    return await prompt.question("");
  } finally {
    muted = false;
    process.stdout.write("\n");
  }
}

try {
  console.log(`Resetting the password for ${owners[0].display_name}.`);
  console.log("Your password will stay hidden and will not be saved locally.");

  const password = await askForSecret("New password (at least 12 characters): ");
  const confirmation = await askForSecret("Confirm new password: ");

  if (password.length < 12) {
    console.error("Password must contain at least 12 characters.");
    process.exitCode = 1;
  } else if (password !== confirmation) {
    console.error("The passwords do not match. No password was changed.");
    process.exitCode = 1;
  } else {
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      owners[0].user_id,
      { password },
    );

    if (updateError) {
      console.error(`Password reset failed: ${updateError.message}`);
      process.exitCode = 1;
    } else {
      console.log("Admin password updated. You can now sign in at /admin/login.");
    }
  }
} finally {
  prompt.close();
}
