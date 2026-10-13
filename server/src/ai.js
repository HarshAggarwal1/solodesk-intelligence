
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
          parts: [{
            text: system +
              "\nYou MUST output exactly one valid JSON object. " +
              "Do not output Markdown, headings, bullet points, or commentary. " +
              "All required fields must contain actual values. " +
              "Never use placeholders such as 'string' or abbreviated arrays."
          }]
        }
      },
        contents: [
        {
          role: "user",
          parts: [{ text: user }]
        }
      ],
        generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: "application/json"
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

  console.log("Gemma response preview:", content?.slice(0, 1500));
  console.log("Gemma response length:", content?.length);

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
Create a useful freelance project proposal based on this brief.

CLIENT BRIEF:
${project.brief}

Return exactly one valid JSON object with these fields:
- title: meaningful project title
- summary: concise explanation of the proposed work
- requirements: array of objects, each with id, description, category, estimatedHours
- assumptions: array of explicit assumptions
- exclusions: array of work not included
- questions: array of questions for the client
- milestones: array of objects with name, description, percentage

Rules:
- Use actual content derived from the brief, never placeholders.
- For "build a zip extraction app", identify plausible features such as ZIP upload,
  archive validation, extraction, file listing, and error handling.
- Include no more than 8 atomic requirements.
- Keep descriptions under 300 characters.
- Estimated hours must be nonnegative numbers.
- Do not invent client approvals, budgets, or requirements.
- Ask questions where platform, file-size limits, or security expectations are unclear.
- Do not use ellipses or abbreviated arrays.
- Return JSON only, without Markdown or commentary.
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
