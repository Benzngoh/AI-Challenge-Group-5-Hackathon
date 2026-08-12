// Vercel Serverless Function — Google Gemini 2.0 Flash Chat Completion
// Endpoint: POST /api/chat
// Expects JSON body: { messages: [{role, content}], tools?: [...] }
// Returns OpenAI-compatible response shape for frontend compatibility.

export default async function handler(req, res) {
  // ─── CORS Headers (allow GitHub Pages origin) ───────────────────────────────
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
    // Fallback: allow all for development convenience
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

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

  // ─── Read Gemini API Key ────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("[/api/chat] GEMINI_API_KEY is not set in environment variables.");
    return res.status(500).json({
      error: "Server misconfiguration: GEMINI_API_KEY is not set.",
      hint: "Add GEMINI_API_KEY to your Vercel project's Environment Variables (get one free at https://aistudio.google.com/app/apikey).",
    });
  }

  // ─── Convert OpenAI-style messages to Gemini format ─────────────────────────
  // Gemini expects: { contents: [{role, parts}], systemInstruction?: {parts} }
  let systemInstruction = null;
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Gemini uses a separate systemInstruction field
      systemInstruction = { parts: [{ text: msg.content }] };
    } else if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      // Map OpenAI "assistant" role → Gemini "model" role
      const parts = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      // Handle tool calls in conversation history
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
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
    } else if (msg.role === "tool") {
      // Tool result messages → Gemini functionResponse
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

  // ─── Convert OpenAI-style tools to Gemini functionDeclarations ──────────────
  let geminiTools = undefined;
  if (tools && Array.isArray(tools) && tools.length > 0) {
    const functionDeclarations = tools
      .filter(t => t.type === "function" && t.function)
      .map(t => {
        const fn = t.function;
        const decl = {
          name: fn.name,
          description: fn.description || "",
        };
        // Convert OpenAI JSON Schema parameters to Gemini format
        if (fn.parameters && Object.keys(fn.parameters).length > 0) {
          decl.parameters = convertSchemaForGemini(fn.parameters);
        }
        return decl;
      });

    if (functionDeclarations.length > 0) {
      geminiTools = [{ functionDeclarations }];
    }
  }

  // ─── Build Gemini request body ──────────────────────────────────────────────
  const geminiBody = { contents };

  if (systemInstruction) {
    geminiBody.systemInstruction = systemInstruction;
  }

  if (geminiTools) {
    geminiBody.tools = geminiTools;
  }

  // Generation config
  geminiBody.generationConfig = {
    temperature: 0.7,
    topP: 0.95,
    maxOutputTokens: 2048,
  };

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  console.log("[/api/chat] Sending request to Gemini:", {
    model: "gemini-2.0-flash",
    messageCount: contents.length,
    hasSystemInstruction: !!systemInstruction,
    toolCount: geminiTools?.[0]?.functionDeclarations?.length || 0,
  });

  try {
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    // ─── Handle non-OK responses from Gemini ──────────────────────────────────
    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (_) {
        errorData = { raw: await response.text().catch(() => "Unable to read error body") };
      }

      console.error("[/api/chat] Gemini API returned error:", {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });

      return res.status(response.status).json({
        error: `Gemini API error (${response.status}): ${response.statusText}`,
        gemini_error: errorData?.error || errorData,
        hint: response.status === 400
          ? "Bad request — check that your messages are properly formatted."
          : response.status === 403
          ? "Your GEMINI_API_KEY is invalid or the API is not enabled. Verify at https://aistudio.google.com/app/apikey."
          : response.status === 429
          ? "Rate limit exceeded. The free Gemini tier has per-minute limits — wait and retry."
          : response.status === 404
          ? "Model not found. Ensure 'gemini-2.0-flash' is available."
          : "Check the gemini_error field for details.",
      });
    }

    // ─── Parse Gemini response ────────────────────────────────────────────────
    const geminiData = await response.json();

    console.log("[/api/chat] Gemini response received:", {
      candidateCount: geminiData.candidates?.length || 0,
      finishReason: geminiData.candidates?.[0]?.finishReason,
    });

    // ─── Transform Gemini response → OpenAI-compatible format ─────────────────
    // Frontend expects: { choices: [{ message: { role, content, tool_calls? } }] }
    const openaiResponse = transformGeminiToOpenAI(geminiData);

    return res.status(200).json(openaiResponse);
  } catch (err) {
    console.error("[/api/chat] Unexpected server error:", err.message, err.stack);
    return res.status(500).json({
      error: "Internal server error — failed to reach Gemini API.",
      message: err.message,
      hint: "This may be a network issue on the server. Check Vercel function logs.",
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert OpenAI JSON Schema → Gemini-compatible schema.
 * Gemini doesn't support "required" at the top level the same way,
 * but it does accept a subset of JSON Schema.
 */
function convertSchemaForGemini(schema) {
  // Gemini accepts: type, properties, required, items, enum, description
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

  if (schema.required) {
    result.required = schema.required;
  }

  if (schema.items) {
    result.items = convertSchemaForGemini(schema.items);
  }

  return result;
}

/**
 * Transform Gemini generateContent response → OpenAI chat completion format.
 * This allows the frontend to remain unchanged.
 */
function transformGeminiToOpenAI(geminiData) {
  const candidate = geminiData.candidates?.[0];

  if (!candidate) {
    return {
      choices: [{
        message: {
          role: "assistant",
          content: "No response generated.",
        },
        finish_reason: "stop",
      }],
    };
  }

  const parts = candidate.content?.parts || [];
  let textContent = "";
  const toolCalls = [];

  for (const part of parts) {
    if (part.text) {
      textContent += part.text;
    }
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

  const message = {
    role: "assistant",
    content: textContent || null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  // Map Gemini finish reasons to OpenAI equivalents
  const finishReasonMap = {
    STOP: "stop",
    MAX_TOKENS: "length",
    SAFETY: "content_filter",
    RECITATION: "content_filter",
    OTHER: "stop",
  };

  return {
    id: `gemini-${Date.now()}`,
    object: "chat.completion",
    model: "gemini-2.0-flash",
    choices: [{
      index: 0,
      message,
      finish_reason: finishReasonMap[candidate.finishReason] || "stop",
    }],
    usage: geminiData.usageMetadata ? {
      prompt_tokens: geminiData.usageMetadata.promptTokenCount || 0,
      completion_tokens: geminiData.usageMetadata.candidatesTokenCount || 0,
      total_tokens: geminiData.usageMetadata.totalTokenCount || 0,
    } : undefined,
  };
}
