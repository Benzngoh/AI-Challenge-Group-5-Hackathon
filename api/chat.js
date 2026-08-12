// Vercel Serverless Function — Google Gemini Chat Completion
// Endpoint: POST /api/chat
// Expects JSON body: { messages: [{role, content}], tools?: [...] }
// Returns OpenAI-compatible response shape for frontend compatibility.

export default async function handler(req, res) {
  // ─── CORS Headers ───────────────────────────────────────────────────────────
  const allowedOrigins = [
    "https://benzngoh.github.io",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ];
  const origin = req.headers.origin || "";
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // ─── GET: Diagnostic — list available models ────────────────────────────────
  if (req.method === "GET") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not set" });
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const listData = await listRes.json();
      const modelNames = (listData.models || []).map(m => m.name).filter(n => n.includes("flash") || n.includes("pro"));
      return res.status(200).json({ available_models: modelNames, hint: "Use one of these model names (after 'models/') in the generateContent URL." });
    } catch (e) {
      return res.status(500).json({ error: "Failed to list models", message: e.message });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ─── Validate request body ──────────────────────────────────────────────────
  const { messages, tools } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: "Missing or invalid 'messages' array in request body.",
      hint: "Send a POST with JSON body: { messages: [{role, content}], tools?: [...] }",
    });
  }

  // ─── Read Gemini API Key ────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Server misconfiguration: GEMINI_API_KEY is not set.",
      hint: "Add GEMINI_API_KEY to your Vercel project's Environment Variables.",
    });
  }

  // ─── Convert messages to Gemini format ──────────────────────────────────────
  let systemInstruction = null;
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      const parts = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || "{}"),
            },
          });
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      contents.push({
        role: "function",
        parts: [{
          functionResponse: {
            name: msg.name || "unknown",
            response: { result: msg.content },
          },
        }],
      });
    }
  }

  // Gemini requires at least one entry in contents
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  // ─── Convert tools to Gemini format ─────────────────────────────────────────
  let geminiTools = undefined;
  if (tools && Array.isArray(tools) && tools.length > 0) {
    const functionDeclarations = tools
      .filter(t => t.type === "function" && t.function)
      .map(t => {
        const fn = t.function;
        const decl = { name: fn.name, description: fn.description || "" };
        if (fn.parameters && Object.keys(fn.parameters).length > 0) {
          decl.parameters = convertSchemaForGemini(fn.parameters);
        }
        return decl;
      });
    if (functionDeclarations.length > 0) {
      geminiTools = [{ functionDeclarations }];
    }
  }

  // ─── Build request body ─────────────────────────────────────────────────────
  const geminiBody = { contents };
  if (systemInstruction) geminiBody.systemInstruction = systemInstruction;
  if (geminiTools) geminiBody.tools = geminiTools;
  geminiBody.generationConfig = { temperature: 0.7, topP: 0.95, maxOutputTokens: 2048 };

  // ─── Try multiple models (in case some are unavailable) ─────────────────────
  const modelsToTry = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];

  let response = null;
  let usedModel = "";

  try {
    for (const modelName of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      console.log(`[/api/chat] Trying model: ${modelName}`);

      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      });

      if (response.ok) {
        usedModel = modelName;
        console.log(`[/api/chat] Success with model: ${modelName}`);
        break;
      }

      if (response.status === 404) {
        console.log(`[/api/chat] Model ${modelName} returned 404, trying next...`);
        response = null;
        continue;
      }

      // Non-404 error — stop trying
      usedModel = modelName;
      break;
    }

    // All models returned 404
    if (!response) {
      return res.status(404).json({
        error: "No working Gemini model found. All candidates returned 404.",
        tried: modelsToTry,
        hint: "Your API key may not have access to generateContent. Try creating a new key at https://aistudio.google.com/app/apikey",
      });
    }

    // Handle non-OK response
    if (!response.ok) {
      let errorData = {};
      try { errorData = await response.json(); } catch (_) { errorData = {}; }

      return res.status(response.status).json({
        error: `Gemini API error (${response.status})`,
        gemini_error: errorData?.error || errorData,
        model_used: usedModel,
        hint: response.status === 400 ? "Bad request format."
          : response.status === 403 ? "API key invalid or API not enabled."
          : response.status === 429 ? "Rate limit exceeded — wait and retry."
          : "Check gemini_error for details.",
      });
    }

    // ─── Success — parse and transform response ─────────────────────────────
    const geminiData = await response.json();
    console.log("[/api/chat] Gemini response:", { model: usedModel, finishReason: geminiData.candidates?.[0]?.finishReason });

    const openaiResponse = transformGeminiToOpenAI(geminiData, usedModel);
    return res.status(200).json(openaiResponse);

  } catch (err) {
    console.error("[/api/chat] Server error:", err.message);
    return res.status(500).json({
      error: "Internal server error",
      message: err.message,
      hint: "Check Vercel function logs for details.",
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function convertSchemaForGemini(schema) {
  const result = {};
  if (schema.type) result.type = schema.type.toUpperCase();
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = convertSchemaForGemini(value);
    }
  }
  if (schema.required) result.required = schema.required;
  if (schema.items) result.items = convertSchemaForGemini(schema.items);
  return result;
}

function transformGeminiToOpenAI(geminiData, modelName) {
  const candidate = geminiData.candidates?.[0];

  if (!candidate) {
    return { choices: [{ message: { role: "assistant", content: "No response generated." }, finish_reason: "stop" }] };
  }

  const parts = candidate.content?.parts || [];
  let textContent = "";
  const toolCalls = [];

  for (const part of parts) {
    if (part.text) textContent += part.text;
    if (part.functionCall) {
      toolCalls.push({
        id: `call_${Math.random().toString(36).substring(2, 11)}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }
  }

  const message = { role: "assistant", content: textContent || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const finishReasonMap = { STOP: "stop", MAX_TOKENS: "length", SAFETY: "content_filter", RECITATION: "content_filter" };

  return {
    id: `gemini-${Date.now()}`,
    object: "chat.completion",
    model: modelName || "gemini-2.5-flash",
    choices: [{ index: 0, message, finish_reason: finishReasonMap[candidate.finishReason] || "stop" }],
    usage: geminiData.usageMetadata ? {
      prompt_tokens: geminiData.usageMetadata.promptTokenCount || 0,
      completion_tokens: geminiData.usageMetadata.candidatesTokenCount || 0,
      total_tokens: geminiData.usageMetadata.totalTokenCount || 0,
    } : undefined,
  };
}
