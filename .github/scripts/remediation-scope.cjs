const NPM_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];
const LOCKFILES_BY_ECOSYSTEM = {
  composer: ["composer.lock"],
  go: ["go.sum"],
  npm: NPM_LOCKFILES,
  nuget: ["packages.lock.json"],
  pub: ["pubspec.lock"],
  rubygems: ["Gemfile.lock"],
  rust: ["Cargo.lock"],
};

function normalizePath(value) {
  return String(value || "").replace(/^\.\//, "").replace(/^\/+/, "");
}

function parseAlertReference(issueBody) {
  const match = String(issueBody || "").match(/skvallerbyttan-alert:(code-scanning|dependabot|secret-scanning):(\d+)/);
  if (!match) return null;
  return { type: match[1], number: Number(match[2]) };
}

function pipLockfiles(manifest) {
  const basename = manifest.slice(manifest.lastIndexOf("/") + 1);
  if (basename === "Pipfile") return ["Pipfile.lock"];
  if (basename === "pyproject.toml") return ["poetry.lock", "uv.lock"];
  return [];
}

function dependabotPaths(manifestPath, ecosystem) {
  const manifest = normalizePath(manifestPath);
  if (!manifest) return [];
  const slash = manifest.lastIndexOf("/");
  const directory = slash >= 0 ? manifest.slice(0, slash + 1) : "";
  const normalizedEcosystem = String(ecosystem || "").toLowerCase();
  const lockfiles = normalizedEcosystem === "pip"
    ? pipLockfiles(manifest)
    : (LOCKFILES_BY_ECOSYSTEM[normalizedEcosystem] || []);
  return [manifest, ...lockfiles.map((name) => `${directory}${name}`)];
}

function expectedPaths(reference, alert, locations = []) {
  if (!reference || String(alert?.state || "").toLowerCase() !== "open") return [];

  if (reference.type === "code-scanning") {
    return [normalizePath(alert?.most_recent_instance?.location?.path)].filter(Boolean);
  }

  if (reference.type === "dependabot") {
    return dependabotPaths(
      alert?.dependency?.manifest_path,
      alert?.dependency?.package?.ecosystem,
    );
  }

  if (reference.type === "secret-scanning") {
    return locations
      .filter((location) => location?.type === "commit")
      .map((location) => normalizePath(location?.details?.path))
      .filter(Boolean);
  }

  return [];
}

function changedPaths(files) {
  const paths = new Set();
  for (const file of files || []) {
    const current = normalizePath(file?.filename);
    const previous = normalizePath(file?.previous_filename);
    if (current) paths.add(current);
    if (previous) paths.add(previous);
  }
  return paths;
}

function evaluateRemediationScope({ issueBody, alert, locations = [], files = [] }) {
  const reference = parseAlertReference(issueBody);
  if (!reference) {
    return { eligible: false, reason: "missing-alert-reference", reference: null, expectedPaths: [] };
  }

  if (String(alert?.state || "").toLowerCase() !== "open") {
    return { eligible: false, reason: "alert-not-open", reference, expectedPaths: [] };
  }

  const paths = [...new Set(expectedPaths(reference, alert, locations))];
  if (paths.length === 0) {
    return { eligible: false, reason: "no-verifiable-alert-path", reference, expectedPaths: [] };
  }

  const changed = changedPaths(files);
  const matchedPath = paths.find((path) => changed.has(path)) || null;
  return {
    eligible: Boolean(matchedPath),
    reason: matchedPath ? "alert-path-changed" : "alert-path-not-changed",
    reference,
    expectedPaths: paths,
    matchedPath,
  };
}

module.exports = {
  dependabotPaths,
  evaluateRemediationScope,
  expectedPaths,
  normalizePath,
  parseAlertReference,
};
