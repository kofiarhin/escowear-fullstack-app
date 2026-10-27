// Private filesystem storage for payment screenshots. Files live outside every
// static/web root (default <repo>/data/payment-proofs, a Docker volume in
// production), under random names, readable only by the app user. Nothing here
// is ever served by express.static; admins read files through a guarded route.
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const KEY = /^[a-f0-9]{24}\/[a-f0-9]{32}\.(jpg|png|webp)$/;

const createProofStorage = ({ rootDir }) => {
  if (!rootDir) throw new Error("A payment proof storage directory is required");
  const root = path.resolve(rootDir);

  // Resolves a storage key to a path, refusing anything that could escape root.
  const resolveKey = (key) => {
    if (typeof key !== "string" || !KEY.test(key)) throw new Error("Invalid storage key");
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  };

  // Writes atomically (temp file + rename) so a crash never leaves a partial image.
  const save = async (orderId, buffer, extension) => {
    const key = `${String(orderId)}/${crypto.randomBytes(16).toString("hex")}.${extension}`;
    const full = resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const temp = `${full}.${crypto.randomBytes(4).toString("hex")}.part`;
    try {
      await fs.writeFile(temp, buffer, { mode: 0o600, flag: "wx" });
      await fs.rename(temp, full);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    return key;
  };

  const read = async (key) => fs.readFile(resolveKey(key));

  const remove = async (key) => {
    await fs.rm(resolveKey(key), { force: true });
  };

  // Removes interrupted temp files older than `olderThanMs` (crash leftovers).
  const sweepPartials = async (olderThanMs = 60 * 60 * 1000, now = Date.now()) => {
    let removed = 0;
    const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const dir of dirs.filter((entry) => entry.isDirectory())) {
      const files = await fs.readdir(path.join(root, dir.name)).catch(() => []);
      for (const name of files.filter((file) => file.endsWith(".part"))) {
        const full = path.join(root, dir.name, name);
        const stat = await fs.stat(full).catch(() => null);
        if (stat && now - stat.mtimeMs > olderThanMs) {
          await fs.rm(full, { force: true });
          removed += 1;
        }
      }
    }
    return removed;
  };

  return { root, read, remove, resolveKey, save, sweepPartials };
};

module.exports = { createProofStorage };
