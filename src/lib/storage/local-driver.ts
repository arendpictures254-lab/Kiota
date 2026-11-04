import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver } from "./index";

/** Development driver: files under ./.storage (gitignored), content type in a sidecar file. */
const root = () => path.resolve(process.env.LOCAL_STORAGE_DIR ?? ".storage");

function fullPath(key: string) {
  const p = path.resolve(root(), key);
  if (!p.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return p;
}

export const localDriver: StorageDriver = {
  name: "local",
  async put(key, bytes, contentType) {
    const p = fullPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, bytes);
    await writeFile(`${p}.type`, contentType);
  },
  async get(key) {
    const p = fullPath(key);
    try {
      const [bytes, type] = await Promise.all([readFile(p), readFile(`${p}.type`, "utf8")]);
      return { bytes, contentType: type };
    } catch {
      return null;
    }
  },
};
