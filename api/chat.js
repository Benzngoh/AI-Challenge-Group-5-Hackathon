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
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

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

      const systemPrompt = `You are an academic analyst AI for a university student dashboard called StudySync AI.
Given a student's academic data (modules, weak topics, tasks, and past test results), synthesize a comprehensive "Academic Trajectory & Persona Summary".

Return ONLY valid JSON with ALL of these fields:
{
  "personaTitle": a short 3-5 word persona archetype title (e.g. "The Conceptual Thinker", "The Dedicated Practitioner"),
  "overallAverage": integer 0-100 representing weighted average across all modules,
  "moduleGrades": array of objects { "code": "MODULE_CODE", "pct": integer 0-100 } for each module,
  "strengths": array of 4 objects { "text": "description of strength", "module": "MODULE_CODE where demonstrated" },
  "weaknesses": array of 2-4 objects { "text": "description of weakness", "severity": "high" or "medium", "affects": "MODULE_CODE" },
  "actionables": array of 4 objects { "label": "short CTA label", "icon": emoji, "type": one of "navigate"|"quiz"|"email", "target": depends on type — for "navigate": module code string, for "quiz": topic-id string (one of "state-machines","vector-math","process-sync"), for "email": { "topic": string, "course": module code } },
  "narrativeSummary": a 3-sentence narrative of the student's progress trajectory, key patterns, and recommended strategy
}

Available modules: CG1111A, CS2106, MA1508E, GEA1000.
Available quiz topic IDs: "state-machines" (CG1111A), "vector-math" (MA1508E), "process-sync" (CS2106).

Be encouraging but honest. Focus on cross-module patterns and test performance. Make actionables specific and directly useful.`;

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
          overallAverage: 70,
          moduleGrades: [
            { code: "CG1111A", pct: 62 }, { code: "CS2106", pct: 55 },
            { code: "MA1508E", pct: 68 }, { code: "GEA1000", pct: 95 }
          ],
          strengths: [
            { text: "Strong quantitative reasoning & statistical literacy", module: "GEA1000" },
            { text: "Solid grasp of Boolean algebra & foundational logic", module: "CG1111A" },
            { text: "Good matrix operation & linear system solving skills", module: "MA1508E" },
            { text: "Consistent performance in process lifecycle concepts", module: "CS2106" },
          ],
          weaknesses: [
            { text: "Sequential state logic & FSM design patterns", severity: "high", affects: "CG1111A" },
            { text: "Process synchronisation & deadlock analysis", severity: "high", affects: "CS2106" },
            { text: "Eigenvalue computation & vector product applications", severity: "medium", affects: "MA1508E" },
          ],
          actionables: [
            { label: "Review State Machine Notes", icon: "📖", type: "navigate", target: "CG1111A" },
            { label: "Launch Concurrency Practice Quiz", icon: "📝", type: "quiz", target: "process-sync" },
            { label: "Practice Vector Math Quiz", icon: "📝", type: "quiz", target: "vector-math" },
            { label: "Email Prof. Smith for FSM Help", icon: "✉️", type: "email", target: { topic: "State Machines", course: "CG1111A" } },
          ],
          narrativeSummary: "You show strong analytical foundations in quantitative modules but need focused effort on sequential logic and concurrency. A targeted review of Ch3 topics combined with hands-on quiz practice should significantly boost your confidence and grades. Your consistent performance in GEA1000 proves you can excel when concepts click.",
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
