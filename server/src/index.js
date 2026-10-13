import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import PDFDocument from "pdfkit";
import {
    z
} from "zod";
import {
    initStore,
    listProjects,
    getProject,
    createProject,
    updateProject,
    getEvents,
    createUser,
    findUserByEmail
} from "./store.js";
import {
    generateProposal,
    analyzeChange
} from "./ai.js";

const app = express();
app.use(helmet());
app.use(cors({
    origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map(s => s.trim()) : true
}));
app.use(express.json({
    limit: "1mb"
}));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        error: "Too many authentication attempts. Try again later."
    }
});
const authSchema = z.object({
    email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
    password: z.string().min(10).max(128)
});

function signToken(user) {
    return jwt.sign({
        sub: user.id,
        email: user.email
    }, process.env.JWT_SECRET, {
        expiresIn: "7d",
        issuer: "solodesk"
    });
}

function authRequired(req, res, next) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({
        error: "Sign in required"
    });
    try {
        const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, {
            issuer: "solodesk"
        });
        req.user = {
            id: payload.sub,
            email: payload.email
        };
        next();
    } catch {
        return res.status(401).json({
            error: "Session expired. Sign in again."
        });
    }
}
const projectSchema = z.object({
    title: z.string().trim().min(2).max(120),
    clientName: z.string().trim().max(120).optional().default(""),
    currency: z.string().trim().length(3).optional().default("INR"),
    hourlyRate: z.number().min(0).max(10000000).optional().default(1000),
    brief: z.string().trim().min(10).max(20000)
});
const changeSchema = z.object({
    request: z.string().trim().min(5).max(10000)
});
const statusSchema = z.object({
    status: z.enum(['draft', 'planning', 'proposal_sent', 'active', 'on_hold', 'completed', 'cancelled', 'archived'])
});

app.get("/api/health", (_req, res) => res.json({
    ok: true,
    service: "solodesk-intelligence",
    aiConfigured: Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL),
    storage: process.env.DATABASE_URL ? "postgres" : "local-json"
}));
app.post("/api/auth/register", authLimiter, async (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({
        error: "Use a valid email and a password of at least 10 characters."
    });
    try {
        const user = {
            id: crypto.randomUUID(),
            email: parsed.data.email,
            passwordHash: await bcrypt.hash(parsed.data.password, 12),
            createdAt: new Date().toISOString()
        };
        const saved = await createUser(user);
        res.status(201).json({
            token: signToken(saved),
            user: saved
        });
    } catch (e) {
        if (String(e.message).includes("EMAIL_EXISTS") || e.code === "23505") return res.status(409).json({
            error: "An account with this email already exists."
        });
        console.error(e);
        res.status(500).json({
            error: "Could not create account."
        });
    }
});
app.post("/api/auth/login", authLimiter, async (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({
        error: "Invalid email or password."
    });
    const user = await findUserByEmail(parsed.data.email);
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({
        error: "Invalid email or password."
    });
    res.json({
        token: signToken(user),
        user: {
            id: user.id,
            email: user.email
        }
    });
});
app.get("/api/projects", authRequired, async (req, res) => res.json(await listProjects(req.user.id)));
app.post("/api/projects", authRequired, async (req, res) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({
        error: "Invalid project",
        details: parsed.error.flatten()
    });
    const now = new Date().toISOString();
    const project = {
        id: crypto.randomUUID(),
        userId: req.user.id,
        title: parsed.data.title,
        clientName: parsed.data.clientName,
        currency: parsed.data.currency.toUpperCase(),
        hourlyRate: parsed.data.hourlyRate,
        brief: parsed.data.brief,
        proposal: null,
        baseline: null,
        changeOrders: [],
        status: 'active',
        createdAt: now,
        updatedAt: now
    };
    res.status(201).json(await createProject(project));
});
app.get("/api/projects/:id", authRequired, async (req, res) => {
    const p = await getProject(req.params.id, req.user.id);
    if (!p) return res.status(404).json({
        error: "Project not found"
    });
    res.json({
        ...p,
        events: await getEvents(p.id)
    });
});
app.patch("/api/projects/:id/status", authRequired, async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({
        error: "Status must be draft, planning, proposal_sent, active, on_hold, completed, cancelled, or archived."
    });
    const p = await getProject(req.params.id, req.user.id);
    if (!p) return res.status(404).json({
        error: "Project not found"
    });
    const saved = await updateProject(p.id, req.user.id, {
        status: parsed.data.status
    }, "project_status_changed", {
        status: parsed.data.status
    });
    res.json(saved);
});
app.post("/api/projects/:id/proposal", authRequired, async (req, res) => {
    const p = await getProject(req.params.id, req.user.id);
    if (!p) return res.status(404).json({
        error: "Project not found"
    });
    try {
        const proposal = await generateProposal(p);
        const saved = await updateProject(p.id, req.user.id, {
            proposal
        }, "proposal_generated", {
            model: proposal.model,
            requirementCount: proposal.requirements.length
        });
        res.json(saved);
    } catch (e) {
        res.status(502).json({
            error: "Proposal generation failed",
            message: e.message
        });
    }
});
app.post("/api/projects/:id/baseline", authRequired, async (req, res) => {
    const p = await getProject(req.params.id, req.user.id);
    if (!p) return res.status(404).json({
        error: "Project not found"
    });
    if (!p.proposal?.requirements?.length) return res.status(400).json({
        error: "Generate a proposal before approving a baseline"
    });
    const baseline = {
        requirements: p.proposal.requirements,
        approvedAt: new Date().toISOString(),
        version: (p.baseline?.version || 0) + 1
    };
    res.json(await updateProject(p.id, req.user.id, {
        baseline
    }, "baseline_approved", {
        version: baseline.version
    }));
});
app.post("/api/projects/:id/analyze-change", authRequired, async (req, res) => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({
        error: "A request of at least 5 characters is required"
    });
    const p = await getProject(req.params.id, req.user.id);
    if (!p) return res.status(404).json({
        error: "Project not found"
    });
    if (!p.baseline && !p.proposal) return res.status(400).json({
        error: "Generate a proposal and approve a baseline first"
    });
    try {
        res.json(await analyzeChange(p, parsed.data.request));
    } catch (e) {
        res.status(502).json({
            error: "Change analysis failed",
            message: e.message
        });
    }
});
app.post("/api/projects/:id/change-orders", authRequired, async (req, res) => {
    const p = await getProject(req.params.id, req.user.id);
    if (!p) return res.status(404).json({
        error: "Project not found"
    });
    const body = z.object({
        analysis: z.any(),
        notes: z.string().max(5000).optional().default("")
    }).safeParse(req.body);
    if (!body.success) return res.status(400).json({
        error: "Invalid change order"
    });
    const analysis = body.data.analysis;
    const extraHours = (analysis.items || []).filter(x => x.classification === "additional_work").reduce((s, x) => s + Math.max(0, Number(x.estimatedAdditionalHours) || 0), 0);
    const order = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        analysis,
        notes: body.data.notes,
        extraHours,
        estimatedCost: Math.round(extraHours * p.hourlyRate * 100) / 100,
        status: "draft"
    };
    const changeOrders = [...(p.changeOrders || []), order];
    res.status(201).json(await updateProject(p.id, req.user.id, {
        changeOrders
    }, "change_order_created", {
        id: order.id,
        estimatedCost: order.estimatedCost
    }));
});

app.post("/api/projects/:id/change-orders/:orderId/approve", authRequired, async (req, res) => {
    const p = await getProject(req.params.id, req.user.id);
    if (!p) {
        return res.status(404).json({
            error: "Project not found"
        });
    }

    const changeOrders = [...(p.changeOrders || [])];
    const index = changeOrders.findIndex(
        order => order.id === req.params.orderId
    );

    if (index === -1) {
        return res.status(404).json({
            error: "Change order not found"
        });
    }

    if (changeOrders[index].status !== "draft") {
        return res.status(400).json({
            error: "Only draft change orders can be approved"
        });
    }

    changeOrders[index] = {
        ...changeOrders[index],
        status: "internally_approved",
        internallyApprovedAt: new Date().toISOString()
    };

    const saved = await updateProject(
        p.id,
        req.user.id, {
            changeOrders
        },
        "change_order_internally_approved", {
            id: changeOrders[index].id
        }
    );

    res.json(saved);
});

app.get("/api/projects/:id/quotation.pdf", authRequired, async (req, res) => {
    const p = await getProject(req.params.id, req.user.id);
    if (!p) return res.status(404).json({
        error: "Project not found"
    });
    const proposal = p.proposal;
    if (!proposal) return res.status(400).json({
        error: "Generate a proposal first"
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="solodesk-quotation-${p.id.slice(0, 8)}.pdf"`);
    const doc = new PDFDocument({
        margin: 52,
        size: "A4"
    });
    doc.pipe(res);
    doc.fontSize(24).text("SoloDesk Intelligence", {
        continued: false
    });
    doc.moveDown(0.4).fontSize(18).text("Project Proposal / Quotation");
    doc.moveDown().fontSize(11).text(`Project: ${p.title}`).text(`Client: ${p.clientName || "Not specified"}`).text(`Date: ${new Date().toLocaleDateString("en-IN")}`).text(`Currency: ${p.currency}`);
    doc.moveDown().fontSize(13).text("Summary");
    doc.fontSize(10).text(proposal.summary || "Review the requirements below.");
    doc.moveDown().fontSize(13).text("Deliverables and estimates");
    let total = 0;
    for (const r of proposal.requirements || []) {
        const hours = Math.max(0, Number(r.estimatedHours) || 0);
        total += hours;
        doc.fontSize(10).text(`${r.description} — ${hours} hours`, {
            indent: 10
        });
    }
    doc.moveDown().fontSize(12).text(`Estimated hours: ${total}`);
    doc.text(`Indicative estimate: ${p.currency} ${(total * p.hourlyRate).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
    doc.fontSize(9).text("This is a draft estimate, not a binding agreement. Confirm scope, rates, taxes, payment terms, and acceptance criteria before sending.", {
        continued: false
    });
    for (const [title, items] of [
            ["Assumptions", proposal.assumptions],
            ["Exclusions", proposal.exclusions],
            ["Open questions", proposal.questions]
        ]) {
        if (items?.length) {
            doc.moveDown().fontSize(12).text(title);
            doc.fontSize(10);
            for (const item of items) doc.text(`• ${item}`, {
                indent: 10
            });
        }
    }
    doc.end();
});
app.get("/api/memory/:projectId", authRequired, async (req, res) => {
    const p = await getProject(req.params.projectId, req.user.id);
    if (!p) return res.status(404).json({
        error: "Project not found"
    });
    // Local project history is the reliable fallback; Backboard can be wired to this interface when account-specific API details are confirmed.
    res.json({
        provider: process.env.BACKBOARD_API_KEY ? "backboard-not-connected" : "local-history",
        project: {
            id: p.id,
            title: p.title,
            baseline: p.baseline,
            changeOrders: p.changeOrders
        },
        events: await getEvents(p.id)
    });
});
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({
        error: "Unexpected server error"
    });
});

const port = Number(process.env.PORT || 8080);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("Set JWT_SECRET to a random secret of at least 32 characters");
await initStore();
app.listen(port, () => console.log(`SoloDesk API listening on ${port}`));