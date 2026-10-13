const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 30000);

const proposalSchema = {
  title: "string",
  summary: "string",
  requirements: [{ id: "string", description: "string", category: "string", estimatedHours: "number" }],
  assumptions: ["string"],
  exclusions: ["string"],
  questions: ["string"],
  milestones: [{ name: "string", description: "string", percentage: "number" }]
};

async function callModel(system, user) {
  if (!process.env.AI_BASE_URL || !process.env.AI_API_KEY || !process.env.AI_MODEL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = process.env.AI_BASE_URL.replace(/\/+$/, "");
    const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: system + "\nReturn only valid JSON. Do not wrap in markdown." },
          { role: "user", content: user }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AI provider returned ${response.status}: ${(await response.text()).slice(0,300)}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned an empty response");
    return JSON.parse(content.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
  } finally { clearTimeout(timer); }
}

export async function generateProposal(project) {
  const prompt = `Client/project brief:\n${project.brief}\n\nReturn JSON matching this shape: ${JSON.stringify(proposalSchema)}. Requirements must be atomic. Estimated hours must be nonnegative numbers. Do not invent a budget or claim that the client agreed to anything. Use questions for missing information.`;
  const modelResult = await callModel(
    "You are a careful operations assistant for independent freelancers. Extract requirements without inventing facts. Estimate effort only as a rough draft and state uncertainty.",
    prompt
  );
  if (modelResult) return normalizeProposal(modelResult, project);
  return fallbackProposal(project);
}

function normalizeProposal(data, project) {
  const requirements = Array.isArray(data.requirements) ? data.requirements.map((r,i)=>({
    id: String(r.id || `req-${i+1}`),
    description: String(r.description || "Unspecified requirement"),
    category: String(r.category || "general"),
    estimatedHours: Math.max(0, Number(r.estimatedHours) || 0)
  })) : [];
  const milestones = Array.isArray(data.milestones) ? data.milestones : [];
  return {
    title: String(data.title || project.title),
    summary: String(data.summary || ""),
    requirements,
    assumptions: stringArray(data.assumptions),
    exclusions: stringArray(data.exclusions),
    questions: stringArray(data.questions),
    milestones: milestones.map((m,i)=>({name:String(m.name||`Milestone ${i+1}`),description:String(m.description||""),percentage:Math.max(0,Math.min(100,Number(m.percentage)||0))})),
    generatedAt: new Date().toISOString(),
    model: process.env.AI_MODEL || "rule-based-demo"
  };
}
function stringArray(x) { return Array.isArray(x) ? x.map(String).slice(0,30) : []; }

function fallbackProposal(project) {
  const lines = project.brief.split(/\n|[.!?]\s+/).map(s=>s.trim()).filter(s=>s.length>12).slice(0,20);
  const requirements = (lines.length ? lines : [project.brief]).map((description,i)=>({
    id:`req-${i+1}`, description:description.slice(0,500), category:"review-needed", estimatedHours:2
  }));
  return {
    title: project.title, summary:"Demo-mode draft. Connect an AI model endpoint for semantic extraction.",
    requirements, assumptions:["Effort estimates are placeholders and must be reviewed."],
    exclusions:["Anything not explicitly included in the approved scope."],
    questions:["What is the acceptance criterion for each deliverable?","Are integrations, hosting, and ongoing support included?"],
    milestones:[{name:"Discovery and confirmation",description:"Confirm scope and acceptance criteria.",percentage:20},{name:"Implementation",description:"Build agreed deliverables.",percentage:60},{name:"Review and handover",description:"Test and hand over approved work.",percentage:20}],
    generatedAt:new Date().toISOString(), model:"rule-based-demo"
  };
}

export async function analyzeChange(project, newRequest) {
  const baseline = project.baseline?.requirements || project.proposal?.requirements || [];
  const modelResult = await callModel(
    "You compare a new client request against an approved project scope. Do not make legal conclusions. Return JSON with summary (string), items (array of {request:string,classification:'already_in_scope'|'additional_work'|'ambiguous'|'conflicting',matchedRequirement:string,reason:string,estimatedAdditionalHours:number}), questions (string array). Be conservative; uncertainty means ambiguous.",
    `Approved scope:\n${JSON.stringify(baseline)}\n\nNew request:\n${newRequest}`
  );
  if (modelResult && Array.isArray(modelResult.items)) return {
    summary:String(modelResult.summary||"Comparison complete"),
    items:modelResult.items.map((x,i)=>({
      id:`change-${i+1}`, request:String(x.request||""), classification:validClass(x.classification),
      matchedRequirement:String(x.matchedRequirement||""), reason:String(x.reason||""),
      estimatedAdditionalHours:Math.max(0,Number(x.estimatedAdditionalHours)||0)
    })),
    questions:stringArray(modelResult.questions), createdAt:new Date().toISOString()
  };
  return fallbackAnalyze(baseline, newRequest);
}

function validClass(x) {
  return ["already_in_scope","additional_work","ambiguous","conflicting"].includes(x) ? x : "ambiguous";
}
function fallbackAnalyze(baseline, newRequest) {
  const requests = newRequest.split(/\n|[.!?]\s+/).map(s=>s.trim()).filter(Boolean);
  const items = requests.map((request,i)=>{
    const words = request.toLowerCase().split(/\W+/).filter(w=>w.length>3);
    let best = null, bestScore = 0;
    for (const req of baseline) {
      const rw = String(req.description).toLowerCase().split(/\W+/).filter(w=>w.length>3);
      const score = words.filter(w=>rw.includes(w)).length / Math.max(1,words.length);
      if (score > bestScore) { bestScore=score; best=req; }
    }
    const classification = bestScore >= 0.5 ? "already_in_scope" : bestScore >= 0.2 ? "ambiguous" : "additional_work";
    return {id:`change-${i+1}`,request,classification,matchedRequirement:best?.description||"",reason:"Rule-based similarity only; review this classification before relying on it.",estimatedAdditionalHours:classification==="additional_work"?2:0};
  });
  return {summary:"Demo-mode comparison. Semantic model analysis is not configured.",items,questions:["Confirm any ambiguous items with the client."],createdAt:new Date().toISOString()};
}
