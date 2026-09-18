/**
 * Volumify - Packaging Script
 * Validates manifest.json, ensures all assets and scripts are present,
 * and packages the extension into a clean distributable ZIP file.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");
const DIST_ZIP = path.join(ROOT_DIR, "volumify-volume-booster.zip");

console.log("==> Auditing extension package before bundling...");

// 1. Validate manifest.json exists
const manifestPath = path.join(SRC_DIR, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("ERROR: manifest.json not found in src/");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
console.log(`✓ Manifest verified: ${manifest.name} v${manifest.version} (MV${manifest.manifest_version})`);

// 2. Verify all background and content scripts exist
const requiredFiles = [
  "background.js",
  "platform-detector.js",
  "audio-engine.js",
  "spa-navigator.js",
  "ui-controller.js",
  "message-bridge.js",
  "content-script.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "content.css",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(SRC_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`ERROR: Missing required file in src/: ${relPath}`);
    process.exit(1);
  }
}
console.log(`✓ All ${requiredFiles.length} critical extension files and assets verified.`);

// 3. Remove old zip if present
if (fs.existsSync(DIST_ZIP)) {
  fs.unlinkSync(DIST_ZIP);
  console.log("✓ Removed existing distribution zip.");
}

// 4. Create ZIP
try {
  if (process.platform === "win32") {
    // Use PowerShell Compress-Archive on Windows
    execSync(`powershell -Command "Compress-Archive -Path '${SRC_DIR}\\*' -DestinationPath '${DIST_ZIP}' -Force"`, {
      stdio: "inherit"
    });
  } else {
    // Unix zip
    execSync(`cd "${SRC_DIR}" && zip -r "${DIST_ZIP}" ./*`, {
      stdio: "inherit"
    });
  }

  const stats = fs.statSync(DIST_ZIP);
  console.log(`\n==> Packaging complete!`);
  console.log(`    File: ${DIST_ZIP}`);
  console.log(`    Size: ${(stats.size / 1024).toFixed(2)} KB`);
} catch (err) {
  console.error("Packaging failed:", err.message);
  process.exit(1);
}
