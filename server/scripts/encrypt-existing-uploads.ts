// One-off migration: encrypt any plaintext KYC/registration documents left
// over from before at-rest encryption was added (see lib/documentEncryption.ts).
// Safe to re-run - files that no longer sniff as a plain image/PDF are assumed
// to already be encrypted ciphertext and are skipped.
import "dotenv/config";
import path from "path";
import { readdir, readFile, writeFile } from "fs/promises";
import { encryptDocument } from "../src/lib/documentEncryption";

const UPLOAD_DIRS = ["uploads/kyc", "uploads/registration"];

async function main() {
  const { fileTypeFromBuffer } = await import("file-type");
  let encrypted = 0;
  let skipped = 0;

  for (const dir of UPLOAD_DIRS) {
    const absDir = path.join(process.cwd(), dir);
    let entries: string[];
    try {
      entries = await readdir(absDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const filePath = path.join(absDir, entry);
      const buffer = await readFile(filePath);
      const detected = await fileTypeFromBuffer(buffer);

      if (!detected || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(detected.mime)) {
        skipped++;
        continue;
      }

      await writeFile(filePath, encryptDocument(buffer));
      console.log(`[encrypt-existing-uploads] Encrypted ${dir}/${entry}`);
      encrypted++;
    }
  }

  console.log(`[encrypt-existing-uploads] Done. Encrypted ${encrypted}, skipped ${skipped} (already encrypted or unrecognized).`);
}

main().catch((err) => {
  console.error("[encrypt-existing-uploads] Failed:", err);
  process.exit(1);
});
