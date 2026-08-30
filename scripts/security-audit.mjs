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

console.log(`Security audit passed (${files.length} tracked files checked).`);
