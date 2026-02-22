export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const lastUser = [...messages].reverse().find((m: any) => m?.role === "user");

  return res.status(200).json({
    reply: `Smoke OK: ${lastUser?.content || "empty message"}`,
  });
}
