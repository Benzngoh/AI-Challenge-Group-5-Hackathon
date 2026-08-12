// Vercel Serverless Function — OpenAI Chat Completion with Function Calling
// Endpoint: POST /api/chat
// Expects JSON body: { messages: [...], tools: [...] }

export default async function handler(req, res) {
  // ─── CORS Headers ───────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ─── Validate request body ──────────────────────────────────────────────────
  const { messages, tools } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing or invalid 'messages' array in request body." });
  }

  // ─── Build OpenAI API request ───────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfiguration: OPENAI_API_KEY not set." });
  }

  const requestBody = {
    model: "gpt-4o-mini",
    messages,
  };

  // Attach tools (function calling) if provided
  if (tools && Array.isArray(tools) && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: "OpenAI API error",
        details: errorData,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  }
}
