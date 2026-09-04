import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const secretPatterns = [
  ["Stripe secret key", /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ["Stripe webhook secret", /whsec_[A-Za-z0-9]{16,}/g],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["Supabase service role JWT", /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
];
const findings = [];

for (const file of files) {
  let contents;
  try { contents = readFileSync(file, "utf8"); } catch { continue; }
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(contents)) findings.push(`${file}: ${label}`);
  }
}

if (findings.length) {
  console.error("Security audit failed. Potential secrets found (values hidden):");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

// Release guard: account recovery is a critical access path. Keep this check in
// the mandatory prebuild so a merge cannot silently remove the UI or endpoint.
const appSource = readFileSync("src/App.tsx", "utf8");
const resetEndpoint = readFileSync("functions/api/request-password-reset.ts", "utf8");
const recoveryChecks = [
  ["password recovery button", appSource.includes("¿Has olvidado tu contraseña?")],
  ["password recovery request", appSource.includes('fetch("/api/request-password-reset"')],
  ["password recovery endpoint", resetEndpoint.includes("/auth/v1/recover")],
  ["password recovery redirect", resetEndpoint.includes("reset-password=1")],
];
const missingRecovery = recoveryChecks.filter(([, present]) => !present).map(([label]) => label);
if (missingRecovery.length) {
  console.error("Security audit failed. Critical account recovery path is incomplete:");
  for (const label of missingRecovery) console.error(`- ${label}`);
  process.exit(1);
}

console.log(`Security audit passed (${files.length} tracked files checked).`);
