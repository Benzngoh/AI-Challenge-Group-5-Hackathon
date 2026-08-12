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
    console.error("[/api/chat] Invalid request: missing or non-array 'messages'", { body: req.body });
    return res.status(400).json({
      error: "Missing or invalid 'messages' array in request body.",
      hint: "Send a POST with JSON body: { messages: [{role, content}], tools?: [...] }",
    });
  }

  // ─── Read API Key ───────────────────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("[/api/chat] OPENAI_API_KEY is not set in environment variables.");
    return res.status(500).json({
      error: "Server misconfiguration: OPENAI_API_KEY is not set.",
      hint: "Add OPENAI_API_KEY to your Vercel project's Environment Variables.",
    });
  }

  // ─── Build OpenAI API request ───────────────────────────────────────────────
  const requestBody = {
    model: "gpt-4o-mini",
    messages,
  };

  // Attach tools (function calling) if provided
  if (tools && Array.isArray(tools) && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }

  console.log("[/api/chat] Sending request to OpenAI:", {
    model: requestBody.model,
    messageCount: messages.length,
    toolCount: requestBody.tools?.length || 0,
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    // ─── Handle non-OK responses from OpenAI ────────────────────────────────
    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (_) {
        errorData = { raw: await response.text().catch(() => "Unable to read error body") };
      }

      console.error("[/api/chat] OpenAI API returned error:", {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });

      return res.status(response.status).json({
        error: `OpenAI API error (${response.status}): ${response.statusText}`,
        openai_error: errorData?.error || errorData,
        hint: response.status === 401
          ? "Your OPENAI_API_KEY is invalid or expired. Check your Vercel environment variables."
          : response.status === 429
          ? "Rate limit exceeded. Wait a moment and try again."
          : response.status === 404
          ? "Model not found. Ensure 'gpt-4o-mini' is available on your OpenAI account."
          : "Check the openai_error field for details.",
      });
    }

    // ─── Success ────────────────────────────────────────────────────────────────
    const data = await response.json();

    console.log("[/api/chat] OpenAI response received:", {
      id: data.id,
      finishReason: data.choices?.[0]?.finish_reason,
      hasToolCalls: !!data.choices?.[0]?.message?.tool_calls,
    });

    return res.status(200).json(data);
  } catch (err) {
    console.error("[/api/chat] Unexpected server error:", err.message, err.stack);
    return res.status(500).json({
      error: "Internal server error — failed to reach OpenAI.",
      message: err.message,
      hint: "This may be a network issue on the server. Check Vercel function logs.",
    });
  }
}
