import { expect } from "vitest";

/** GitHub Releases ปลอมในหน่วยความจำ (เฉพาะ endpoint ที่ snapshot ใช้) */
export function fakeGithub(opts: { down?: boolean } = {}) {
  let release: { id: number; assets: { id: number; name: string; url: string }[] } | undefined;
  const blobs = new Map<number, Buffer>();
  let nextId = 1;
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push(`${method} ${url}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    if (opts.down) return new Response("unavailable", { status: 503 });
    if (url.endsWith("/releases/tags/db-backup")) return release ? Response.json(release) : new Response("", { status: 404 });
    if (method === "POST" && url.endsWith("/repos/me/data/releases")) {
      release = { id: 7, assets: [] };
      return Response.json(release, { status: 201 });
    }
    const upload = url.match(/uploads\.github\.com\/repos\/me\/data\/releases\/7\/assets\?name=(.+)$/);
    if (upload && method === "POST") {
      const id = nextId++;
      blobs.set(id, Buffer.from(init.body as Uint8Array));
      release!.assets.push({ id, name: decodeURIComponent(upload[1]!), url: `https://api.github.com/repos/me/data/releases/assets/${id}` });
      return Response.json({ id }, { status: 201 });
    }
    const asset = url.match(/releases\/assets\/(\d+)$/);
    if (asset) {
      const id = Number(asset[1]);
      if (method === "DELETE") {
        release!.assets = release!.assets.filter((a) => a.id !== id);
        return new Response(null, { status: 204 });
      }
      return new Response(new Uint8Array(blobs.get(id)!));
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetchImpl, calls, get release() { return release; } };
}

