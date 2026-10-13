
const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 30000);

const proposalSchema = {
  title: "string",
  summary: "string",
  requirements: [
    {
      id: "string",
      description: "string",
      category: "string",
      estimatedHours: "number"
    }
  ],
  assumptions: ["string"],
  exclusions: ["string"],
  questions: ["string"],
  milestones: [
    {
      name: "string",
      description: "string",
      percentage: "number"
    }
  ]
};



function parseModelJson(content) {
  const text = content
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const start = text.indexOf("{");

  if (start === -1) {
    throw new Error("Gemma returned no JSON object");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;

      if (depth === 0) {
        const jsonText = text.slice(start, i + 1);

        try {
          return JSON.parse(jsonText);
        } catch (error) {
          throw new Error(
            `Gemma returned malformed JSON: ${error.message}`
          );
        }
      }
    }
  }

  throw new Error("Gemma returned incomplete JSON");
}


async function callModel(system, user) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMMA_MODEL;

  if (!apiKey || !model) {
    throw new Error("GEMINI_API_KEY or GEMMA_MODEL is missing");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                system +
                "\nOutput exactly one JSON object. No Markdown, no bullet points, and no text before or after the JSON."
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: user }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Gemma API returned ${response.status}: ${detail}`);
    }

    const data = await response.json();

    const content = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!content) {
      throw new Error("Gemma API returned an empty response");
    }

    return parseModelJson(content);

  } finally {
    clearTimeout(timer);
  }
}

export async function generateProposal(project) {


  const prompt = `
  You must create a real project proposal from the client brief below.

  CLIENT BRIEF:
  ${project.brief}

  Return exactly one valid JSON object with these fields:
  ${JSON.stringify(proposalSchema)}

  IMPORTANT RULES:
  - The schema describes data types, NOT example values.
  - Never output literal placeholders such as "string", "number", or "string".
  - Write a meaningful title and summary based on the actual brief.
  - Extract concrete, atomic requirements from the brief.
  - Include at most 20 requirements.
  - Keep each requirement description under 300 characters.
  - Estimated hours must be nonnegative numbers.
  - State assumptions explicitly. Do not present assumptions as client-approved facts.
  - Identify missing details as questions.
  - Do not invent a budget or claim that the client agreed to anything.
  - If the brief is vague, create a preliminary proposal and ask relevant questions.
  - Do not repeat the input brief as the summary.
  - Return JSON only, with no Markdown or commentary.
  - Every field must contain actual values, not schema placeholders.
  - Do not use ellipses (...), comments, or abbreviated arrays.
  - Include no more than 8 requirements.
  - Return a complete JSON object with every required field.
  `;



  const modelResult = await callModel(
    "You are a careful operations assistant for independent freelancers. " +
    "Extract requirements without inventing facts. " +
    "Treat effort estimates as rough drafts and state uncertainty.",
    prompt
  );

  return normalizeProposal(modelResult, project);
}

function normalizeProposal(data, project) {

  if (
    !data.title ||
    data.title.trim().toLowerCase() === "string" ||
    !data.summary ||
    data.summary.trim().toLowerCase() === "string"
  ) {
    throw new Error("Gemma returned placeholder proposal values");
  }

  const requirements = Array.isArray(data.requirements)
    ? data.requirements.map((r, i) => ({
      id: String(r.id || `req-${i + 1}`),
      description: String(r.description || "Unspecified requirement"),
      category: String(r.category || "general"),
      estimatedHours: Math.max(
        0,
        Number(r.estimatedHours) || 0
      )
    }))
    : [];

  const milestones = Array.isArray(data.milestones)
    ? data.milestones
    : [];

  return {
    title: String(data.title || project.title),
    summary: String(data.summary || ""),
    requirements,
    assumptions: stringArray(data.assumptions),
    exclusions: stringArray(data.exclusions),
    questions: stringArray(data.questions),
    milestones: milestones.map((m, i) => ({
      name: String(m.name || `Milestone ${i + 1}`),
      description: String(m.description || ""),
      percentage: Math.max(
        0,
        Math.min(100, Number(m.percentage) || 0)
      )
    })),
    generatedAt: new Date().toISOString(),
    model: process.env.GEMMA_MODEL
  };
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.map(String).slice(0, 30)
    : [];
}

export async function analyzeChange(project, newRequest) {
  const baseline =
    project.baseline?.requirements ||
    project.proposal?.requirements ||
    [];

  const modelResult = await callModel(
    `You compare a new client request against an approved project scope.
Do not make legal conclusions.
Return JSON with:
- summary: string
- items: array of objects containing
  request: string,
  classification: one of "already_in_scope", "additional_work",
  "ambiguous", or "conflicting",
  matchedRequirement: string,
  reason: string,
  estimatedAdditionalHours: nonnegative number
- questions: string array

Be conservative. Uncertainty means ambiguous.`,
    `Approved scope:\n${JSON.stringify(baseline)}\n\nNew request:\n${newRequest}`
  );

  if (!Array.isArray(modelResult.items)) {
    throw new Error("Gemma returned an invalid scope analysis");
  }

  return {
    summary: String(modelResult.summary || "Comparison complete"),
    items: modelResult.items.map((item, i) => ({
      id: `change-${i + 1}`,
      request: String(item.request || ""),
      classification: validClass(item.classification),
      matchedRequirement: String(item.matchedRequirement || ""),
      reason: String(item.reason || ""),
      estimatedAdditionalHours: Math.max(
        0,
        Number(item.estimatedAdditionalHours) || 0
      )
    })),
    questions: stringArray(modelResult.questions),
    createdAt: new Date().toISOString()
  };
}

function validClass(value) {
  return [
    "already_in_scope",
    "additional_work",
    "ambiguous",
    "conflicting"
  ].includes(value)
    ? value
    : "ambiguous";
}
