const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const { contextType, message, studentData } = req.body;

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // INTENT_ROUTER — Observation 1
    // ─────────────────────────────────────────────────────────────────────────
    if (contextType === "INTENT_ROUTER") {
      if (!message) {
        return res.status(400).json({ error: "message is required for INTENT_ROUTER" });
      }

      const systemPrompt = `You are an intent router for a student dashboard app called StudySync AI.
Given a user message, classify it into one of the following actions and return structured JSON.

Actions:
- "LIST_TASKS" — user wants to see tasks, optionally filtered (e.g. "show overdue tasks", "what's due soon")
- "NAVIGATE_MODULE" — user wants to navigate to a specific module page (e.g. "open CG1111A", "go to Operating Systems")
- "GENERATE_QUIZ" — user wants a practice quiz on a topic (e.g. "quiz me on state machines", "practice process sync")
- "CHAT_RESPONSE" — general conversation, explanations, or anything that doesn't fit above

Return ONLY valid JSON with these fields:
{
  "action": one of "LIST_TASKS" | "NAVIGATE_MODULE" | "GENERATE_QUIZ" | "CHAT_RESPONSE",
  "filter": relevant filter string (e.g. "overdue", "due-soon", "upcoming", or null),
  "targetModule": module code if NAVIGATE_MODULE (e.g. "CG1111A", "CS2106", "MA1508E", "GEA1000") or null,
  "replyText": a short friendly reply text to show the user (1-2 sentences)
}

Available modules: CG1111A (Engineering Principles & Practice), CS2106 (Operating Systems), MA1508E (Linear Algebra), GEA1000 (Quantitative Reasoning).
Available quiz topics: "state-machines" (CG1111A), "vector-math" (MA1508E), "process-sync" (CS2106).
Task filters: "overdue", "due-soon", "upcoming".`;

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nUser message: "${message}"` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });

      const responseText = result.response.text();
      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        // If JSON parsing fails, return a safe fallback
        parsed = {
          action: "CHAT_RESPONSE",
          filter: null,
          targetModule: null,
          replyText: responseText.substring(0, 200),
        };
      }

      return res.status(200).json(parsed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERSONA_SYNTHESIS — Observation 2
    // ─────────────────────────────────────────────────────────────────────────
    if (contextType === "PERSONA_SYNTHESIS") {
      if (!studentData) {
        return res.status(400).json({ error: "studentData is required for PERSONA_SYNTHESIS" });
      }

      const systemPrompt = `You are an academic analyst AI for a university student dashboard.
Given a student's academic data (modules, weak topics, tasks, and past test results), synthesize a concise "Academic Persona" summary.

Return ONLY valid JSON with these fields:
{
  "personaTitle": a short 3-5 word persona archetype title (e.g. "The Conceptual Thinker", "The Dedicated Practitioner"),
  "narrativeSummary": a 2-3 sentence narrative summary of the student's academic profile, strengths, and areas for growth,
  "keyWeaknesses": an array of 2-4 strings identifying the most critical weakness areas,
  "actionItems": an array of 2-4 specific, actionable recommendations for improvement
}

Be encouraging but honest. Focus on patterns across modules and test performance.`;

      const dataPayload = JSON.stringify(studentData, null, 2);

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nStudent Data:\n${dataPayload}` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.4,
        },
      });

      const responseText = result.response.text();
      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        parsed = {
          personaTitle: "The Growing Scholar",
          narrativeSummary: responseText.substring(0, 300),
          keyWeaknesses: ["Unable to parse detailed weaknesses"],
          actionItems: ["Review study materials and try again"],
        };
      }

      return res.status(200).json(parsed);
    }

    // Unknown contextType
    return res.status(400).json({ error: `Unknown contextType: ${contextType}` });

  } catch (error) {
    console.error("Gemini API error:", error);
    return res.status(500).json({
      error: "Failed to process request",
      details: error.message || "Unknown error",
    });
  }
};
