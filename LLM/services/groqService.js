
import { Groq } from "groq-sdk";
import { config } from "../config.js";

if (!config.groqApiKey) {
  throw new Error("GROQ_API_KEY is missing from .env");
}

const groq = new Groq({
  apiKey: config.groqApiKey
});

const SYSTEM_PROMPT = `
You are a real-time meeting analysis assistant.

Analyze the new transcript and update the existing meeting state.

RULES:
1. Preserve existing topics and IDs when possible.
2. Create new topics only when the discussion introduces them.
3. Give each topic 2-4 short summary points.
4. Each point must express one idea in a short sentence.
5. Keep meeting_summary to 1-2 short sentences.
6. Extract decisions and action items explicitly stated.
7. Never invent names, deadlines, decisions, or facts.
8. Use only these nature values:
   decision, brainstorming, informational,
   problem_solving, planning, review.
9. Use "active" for ongoing topics and "completed"
   only when the transcript supports completion.
10. Return valid JSON only. Do not use Markdown fences.

Return this structure:
{
  "meeting_title": "Meeting title",
  "meeting_summary": "Short overall summary.",
  "meeting_status": "in_progress",
  "topics": [
    {
      "topic_id": 1,
      "topic_name": "Project Planning",
      "nature": "planning",
      "status": "active",
      "start_time": "00:00:00",
      "end_time": "ongoing",
      "summary_points": [
        "Complete the frontend.",
        "Test the dashboard."
      ],
      "action_items": [],
      "branched_from": null
    }
  ]
}
`;

export async function analyzeTranscript(currentState, recentTranscript) {
  if (!recentTranscript?.trim()) {
    throw new Error("No transcript available for analysis.");
  }

  const userPrompt = `
CURRENT MEETING STATE:
${JSON.stringify(currentState)}

NEW TRANSCRIPT:
${recentTranscript}

Return the updated meeting state as JSON.
`;

  try {
    const response = await groq.chat.completions.create({
      model: config.groqModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      response_format: { type: "json_object" }
    });

    const raw = response.choices[0]?.message?.content;

    if (!raw) {
      throw new Error("Groq returned an empty response.");
    }

    const result = JSON.parse(raw);

    if (!Array.isArray(result.topics)) {
      throw new Error("Groq response is missing the topics array.");
    }

    result.meeting_summary ??= currentState.meeting_summary ?? "";
    result.transcript = currentState.transcript ?? "";

    return result;
  } catch (err) {
    console.error("Groq analysis failed:", err.message);
    throw err;
  }
}
