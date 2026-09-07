const DEFAULT_SCHEDULES = [];

async function kvRequest(path, options = {}) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("KV/Upstash environment variables belum diatur.");
  const r = await fetch(url + path, {
    ...options,
    headers: { "Authorization": `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const result = await kvRequest("/get/pbwSchedules2026");
      let data = result?.result;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
      if (!Array.isArray(data) || !data.length) data = DEFAULT_SCHEDULES;
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!Array.isArray(data)) return res.status(400).json({ok:false,message:"Data jadwal tidak valid"});
      await kvRequest("/set/pbwSchedules2026", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(JSON.stringify(data))
      });
      return res.status(200).json({ok:true});
    }

    return res.status(405).json({ok:false,message:"Method tidak didukung"});
  } catch (e) {
    return res.status(500).json({ok:false,message:e.message});
  }
}
