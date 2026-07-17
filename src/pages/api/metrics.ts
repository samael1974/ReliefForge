const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(path: string, init?: RequestInit) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("Missing UPSTASH env vars");
  }

  const res = await fetch(`${UPSTASH_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Upstash error ${res.status}: ${txt}`);
  }

  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  try {
    const action = String(req.query?.action || "").trim();
    if (!action) return res.status(400).json({ ok: false, error: "Missing action" });

    const key = `rf:${action}`;

    if (req.method === "POST") {
      await redis(`/incr/${encodeURIComponent(key)}`, { method: "POST" });
      const r = await redis(`/get/${encodeURIComponent(key)}`, { method: "GET" });
      return res.status(200).json({ ok: true, action, value: Number(r?.result ?? 0) });
    }

    if (req.method === "GET") {
      const r = await redis(`/get/${encodeURIComponent(key)}`, { method: "GET" });
      return res.status(200).json({ ok: true, action, value: Number(r?.result ?? 0) });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? "Server error" });
  }
}
