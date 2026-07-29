import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";

type ObjectMetadata = {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

type StoredObject = {
  key: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

const storageRoot = resolve(process.env.ARTWORKS_DIR || join(process.cwd(), ".data", "artworks"));

function objectPath(key: string) {
  const cleanKey = normalize(key.replaceAll("\\", "/")).replace(/^([/\\])+/, "");
  const target = resolve(storageRoot, cleanKey);
  if (target !== storageRoot && !target.startsWith(`${storageRoot}${sep}`)) {
    throw new Error("Invalid storage key");
  }
  return target;
}

async function readMetadata(path: string): Promise<ObjectMetadata> {
  try {
    return JSON.parse(await readFile(`${path}.meta.json`, "utf8")) as ObjectMetadata;
  } catch {
    return {};
  }
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async entry => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(path);
      return entry.name.endsWith(".meta.json") ? [] : [path];
    }));
    return files.flat();
  } catch {
    return [];
  }
}

class LocalArtworkBucket {
  async get(key: string): Promise<StoredObject | null> {
    const path = objectPath(key);
    try {
      const [bytes, metadata, details] = await Promise.all([
        readFile(path),
        readMetadata(path),
        stat(path),
      ]);
      return {
        key,
        uploaded: details.mtime,
        ...metadata,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      };
    } catch {
      return null;
    }
  }

  async put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream, options?: ObjectMetadata) {
    const path = objectPath(key);
    await mkdir(dirname(path), { recursive: true });
    let bytes: Uint8Array;
    if (value instanceof ReadableStream) {
      bytes = new Uint8Array(await new Response(value).arrayBuffer());
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      bytes = new Uint8Array(value);
    }
    await writeFile(path, bytes);
    await writeFile(`${path}.meta.json`, JSON.stringify(options || {}), "utf8");
    return { key };
  }

  async delete(key: string) {
    const path = objectPath(key);
    await Promise.all([
      unlink(path).catch(() => undefined),
      unlink(`${path}.meta.json`).catch(() => undefined),
    ]);
  }

  async list(options?: { prefix?: string; limit?: number; include?: string[] }) {
    const prefix = options?.prefix || "";
    const files = await listFiles(storageRoot);
    const objects = await Promise.all(files
      .map(path => path.slice(storageRoot.length + 1).split(sep).join("/"))
      .filter(key => key.startsWith(prefix))
      .slice(0, options?.limit || 1000)
      .map(async key => {
        const path = objectPath(key);
        const [details, metadata] = await Promise.all([stat(path), readMetadata(path)]);
        return { key, uploaded: details.mtime, customMetadata: metadata.customMetadata };
      }));
    return { objects };
  }
}

const artworks = new LocalArtworkBucket();

export const env = new Proxy({ ARTWORKS: artworks } as Record<string, unknown>, {
  get(target, property) {
    if (property in target) return target[property as string];
    return process.env[String(property)];
  },
});
