import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), "..");
const assistantRoot = path.join(projectRoot, "dispatch-assistant");
const configPath = path.join(assistantRoot, "config.json");
const statePath = path.join(assistantRoot, "state.json");
const stateExamplePath = path.join(assistantRoot, "state.example.json");
const runtimeRoot = path.join(assistantRoot, "runtime");
const pendingPath = path.join(runtimeRoot, "pending-scan.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureState() {
  if (!fs.existsSync(statePath)) {
    writeJson(statePath, readJson(stateExamplePath));
  }
}

function normalizePath(filePath) {
  return path.resolve(filePath).replaceAll("/", "\\").toLowerCase();
}

function fingerprint(filePath, stats) {
  const payload = `${normalizePath(filePath)}|${stats.size}|${Math.trunc(stats.mtimeMs)}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function walkFiles(root, allowedExtensions) {
  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Unable to read attachment directory ${current}: ${error.message}`);
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
        const stats = fs.statSync(fullPath);
        files.push({
          id: fingerprint(fullPath, stats),
          path: fullPath,
          name: entry.name,
          extension: path.extname(entry.name).toLowerCase(),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          sourceAttribution: "unattributed-wechat-attachment"
        });
      }
    }
  }

  return files.sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt) || a.path.localeCompare(b.path));
}

function loadContext() {
  const config = readJson(configPath);
  ensureState();
  const state = readJson(statePath);
  const root = config.wechat.attachmentRoot;
  if (!fs.existsSync(root)) {
    throw new Error(`Configured attachment root does not exist: ${root}`);
  }
  const allowed = new Set(config.attachmentExtensions.map((extension) => extension.toLowerCase()));
  return { config, state, root, files: walkFiles(root, allowed) };
}

function pruneProcessed(processed, limit = 20000) {
  const entries = Object.entries(processed);
  if (entries.length <= limit) return processed;
  entries.sort((a, b) => String(b[1].processedAt).localeCompare(String(a[1].processedAt)));
  return Object.fromEntries(entries.slice(0, limit));
}

function reconcileVerifiedSources(state, files) {
  state.verifiedSources ??= {};
  const currentFilesByPath = new Map(files.map((file) => [normalizePath(file.path), file]));
  const invalidated = [];
  for (const [verifiedPath, verification] of Object.entries(state.verifiedSources)) {
    const normalizedVerifiedPath = normalizePath(verifiedPath);
    const currentFile = currentFilesByPath.get(normalizedVerifiedPath);
    if (
      !currentFile
      || currentFile.size !== verification.size
      || currentFile.modifiedAt !== verification.modifiedAt
    ) {
      delete state.verifiedSources[verifiedPath];
      invalidated.push(verification.path ?? verifiedPath);
    }
  }
  return invalidated;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const command = process.argv[2] ?? "scan";

try {
  if (command === "status") {
    const { state, files } = loadContext();
    const invalidatedVerifiedSources = reconcileVerifiedSources(state, files);
    if (invalidatedVerifiedSources.length > 0) {
      writeJson(statePath, state);
    }
    output({
      baselineCreatedAt: state.baselineCreatedAt,
      lastSuccessfulScanAt: state.lastSuccessfulScanAt,
      verifiedSourceCount: Object.keys(state.verifiedSources ?? {}).length,
      invalidatedVerifiedSources,
      processedAttachmentCount: Object.keys(state.processedAttachments ?? {}).length,
      pendingManifest: fs.existsSync(pendingPath) ? readJson(pendingPath) : null
    });
    process.exit(0);
  }

  const { state, files } = loadContext();
  state.processedAttachments ??= {};
  state.verifiedSources ??= {};
  const invalidatedVerifiedSources = reconcileVerifiedSources(state, files);
  if (invalidatedVerifiedSources.length > 0) {
    writeJson(statePath, state);
  }
  const now = new Date().toISOString();

  if (command === "verify") {
    const targetPath = path.resolve(process.argv[3] ?? "");
    const role = process.argv[4];
    const evidence = process.argv[5];
    if (!process.argv[3] || !role || !evidence) {
      throw new Error("Usage: node scripts/dispatch_attachment_scan.mjs verify <filePath> <role> <evidence>");
    }
    const file = files.find((candidate) => normalizePath(candidate.path) === normalizePath(targetPath));
    if (!file) {
      throw new Error(`The file is not an eligible attachment under the configured root: ${targetPath}`);
    }
    state.verifiedSources[normalizePath(file.path)] = {
      path: file.path,
      role,
      evidence,
      verifiedAt: now,
      modifiedAt: file.modifiedAt,
      size: file.size
    };
    writeJson(statePath, state);
    output({ status: "source_verified", path: file.path, role, evidence, verifiedAt: now });
    process.exit(0);
  }

  if (command === "baseline") {
    for (const file of files) {
      state.processedAttachments[file.id] = {
        path: file.path,
        size: file.size,
        modifiedAt: file.modifiedAt,
        processedAt: now,
        reason: "initial_baseline"
      };
    }
    state.processedAttachments = pruneProcessed(state.processedAttachments);
    state.baselineCreatedAt = state.baselineCreatedAt ?? now;
    state.lastSuccessfulScanAt = now;
    writeJson(statePath, state);
    output({ status: "baseline_created", at: now, attachmentCount: files.length });
    process.exit(0);
  }

  if (command === "scan") {
    const candidates = files.filter((file) => !state.processedAttachments[file.id]);
    const manifest = {
      version: 1,
      manifestId: crypto.randomUUID(),
      createdAt: now,
      invalidatedVerifiedSources,
      candidateCount: candidates.length,
      candidates
    };
    writeJson(pendingPath, manifest);
    output(manifest);
    process.exit(0);
  }

  if (command === "commit") {
    const requestedManifestId = process.argv[3];
    if (!requestedManifestId) {
      throw new Error("Usage: node scripts/dispatch_attachment_scan.mjs commit <manifestId>");
    }
    if (!fs.existsSync(pendingPath)) {
      throw new Error("No pending scan manifest exists.");
    }
    const manifest = readJson(pendingPath);
    if (manifest.manifestId !== requestedManifestId) {
      throw new Error(`Manifest mismatch. Pending=${manifest.manifestId}; requested=${requestedManifestId}`);
    }
    for (const file of manifest.candidates) {
      state.processedAttachments[file.id] = {
        path: file.path,
        size: file.size,
        modifiedAt: file.modifiedAt,
        processedAt: now,
        reason: "successful_dispatch_run"
      };
    }
    state.processedAttachments = pruneProcessed(state.processedAttachments);
    state.lastSuccessfulScanAt = now;
    writeJson(statePath, state);
    fs.rmSync(pendingPath, { force: true });
    output({
      status: "committed",
      manifestId: requestedManifestId,
      committedAt: now,
      attachmentCount: manifest.candidateCount
    });
    process.exit(0);
  }

  throw new Error(`Unknown command: ${command}`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
