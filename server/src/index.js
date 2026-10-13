import { randomBytes, createHash } from "node:crypto";
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
    findUserByEmail,
    findProjectByApprovalTokenHash
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

const hashApprovalToken = token =>
    createHash("sha256").update(token).digest("hex");

// Freelancer generates a client approval link.
app.post(
    "/api/projects/:id/change-orders/:orderId/send-for-approval",
    authRequired,
    async (req, res) => {
        const p = await getProject(req.params.id, req.user.id);

        if (!p) {
            return res.status(404).json({ error: "Project not found" });
        }

        const changeOrders = [...(p.changeOrders || [])];
        const index = changeOrders.findIndex(
            order => order.id === req.params.orderId
        );

        if (index === -1) {
            return res.status(404).json({ error: "Change order not found" });
        }

        const order = changeOrders[index];

        if (!["internally_approved", "sent_to_client"].includes(order.status)) {
            return res.status(400).json({
                error: "Internally approve the change order before sending it"
            });
        }

        if (order.status === "sent_to_client" &&
            order.clientApproval?.expiresAt &&
            new Date(order.clientApproval.expiresAt) > new Date()) {
            return res.status(409).json({
                error: "An active approval link already exists"
            });
        }

        const token = randomBytes(32).toString("hex");
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
            .toISOString();

        changeOrders[index] = {
            ...order,
            status: "sent_to_client",
            sentToClientAt: now.toISOString(),
            clientApproval: {
                tokenHash: hashApprovalToken(token),
                expiresAt,
                decision: null,
                decidedAt: null
            }
        };

        await updateProject(
            p.id,
            req.user.id,
            { changeOrders },
            "change_order_sent_to_client",
            { id: order.id, expiresAt }
        );

        const frontendUrl = (
            process.env.CLIENT_URL || "https://solodesk-frontend.onrender.com"
        ).replace(/\/+$/, "");

        res.json({
            approvalUrl: `${frontendUrl}/client-approval/${token}`,
            expiresAt
        });
    }
);

// Public endpoint: client views the change order.
app.get("/api/client-approval/:token", async (req, res) => {
    const token = req.params.token;

    if (!/^[a-f0-9]{64}$/.test(token)) {
        return res.status(404).json({ error: "Invalid approval link" });
    }

    const p = await findProjectByApprovalTokenHash(hashApprovalToken(token));

    if (!p) {
        return res.status(404).json({ error: "Invalid approval link" });
    }

    const order = (p.changeOrders || []).find(
        item => item.clientApproval?.tokenHash === hashApprovalToken(token)
    );

    if (!order) {
        return res.status(404).json({ error: "Invalid approval link" });
    }

    if (new Date(order.clientApproval.expiresAt) <= new Date()) {
        return res.status(410).json({ error: "This approval link has expired" });
    }

    res.setHeader("Cache-Control", "no-store");

    res.json({
        projectTitle: p.title,
        clientName: p.clientName,
        currency: p.currency,
        changeOrder: {
            id: order.id,
            notes: order.notes || "",
            items: (order.analysis?.items || []).map(item => ({
                request: item.request,
                classification: item.classification,
                estimatedAdditionalHours: item.estimatedAdditionalHours
            })),
            extraHours: order.extraHours,
            estimatedCost: order.estimatedCost,
            status: order.status
        },
        decision: order.clientApproval.decision
    });
});

// Public endpoint: client accepts or rejects the change order.
app.post("/api/client-approval/:token/decision", async (req, res) => {
    const token = req.params.token;

    if (!/^[a-f0-9]{64}$/.test(token)) {
        return res.status(404).json({ error: "Invalid approval link" });
    }

    const parsed = z.object({
        decision: z.enum(["client_approved", "client_rejected"])
    }).safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Decision must be client_approved or client_rejected"
        });
    }

    const tokenHash = hashApprovalToken(token);
    const p = await findProjectByApprovalTokenHash(tokenHash);

    if (!p) {
        return res.status(404).json({ error: "Invalid approval link" });
    }

    const changeOrders = [...(p.changeOrders || [])];
    const index = changeOrders.findIndex(
        order => order.clientApproval?.tokenHash === tokenHash
    );

    if (index === -1) {
        return res.status(404).json({ error: "Invalid approval link" });
    }

    const order = changeOrders[index];

    if (new Date(order.clientApproval.expiresAt) <= new Date()) {
        return res.status(410).json({ error: "This approval link has expired" });
    }

    if (order.status !== "sent_to_client" ||
        order.clientApproval.decision) {
        return res.status(409).json({
            error: "A decision has already been recorded or this order is no longer pending"
        });
    }

    const decidedAt = new Date().toISOString();

    changeOrders[index] = {
        ...order,
        status: parsed.data.decision,
        clientApproval: {
            ...order.clientApproval,
            decision: parsed.data.decision,
            decidedAt
        }
    };

    await updateProject(
        p.id,
        p.userId,
        { changeOrders },
        parsed.data.decision === "client_approved"
            ? "change_order_client_approved"
            : "change_order_client_rejected",
        { id: order.id, decidedAt }
    );

    res.json({
        success: true,
        decision: parsed.data.decision,
        decidedAt
    });
});

app.get("/api/projects/:id/quotation.pdf", authRequired, async (req, res) => {
  try {
    const p = await getProject(req.params.id, req.user.id);

    if (!p) {
      return res.status(404).json({ error: "Project not found" });
    }

    const proposal = p.proposal;

    if (!proposal) {
      return res.status(400).json({ error: "Generate a proposal first" });
    }

    const currency = p.currency || "INR";
    const rate = Math.max(0, Number(p.hourlyRate) || 0);
    const requirements = proposal.requirements || [];
    const changeOrders = p.changeOrders || [];

    const originalHours = requirements.reduce(
      (sum, item) => sum + Math.max(0, Number(item.estimatedHours) || 0),
      0
    );

    const originalCost = originalHours * rate;

    const orderValue = order =>
      Math.max(0, Number(order.estimatedCost) || 0);

    const orderHours = order =>
      Math.max(0, Number(order.extraHours) || 0);

    const pendingStatuses = [
      "draft",
      "internally_approved",
      "sent_to_client"
    ];

    const pendingOrders = changeOrders.filter(order =>
      pendingStatuses.includes(order.status || "draft")
    );

    const approvedOrders = changeOrders.filter(
      order => order.status === "client_approved"
    );

    const pendingValue = pendingOrders.reduce(
      (sum, order) => sum + orderValue(order),
      0
    );

    const approvedValue = approvedOrders.reduce(
      (sum, order) => sum + orderValue(order),
      0
    );

    const approvedHours = approvedOrders.reduce(
      (sum, order) => sum + orderHours(order),
      0
    );

    const money = value =>
      `${currency} ${Number(value || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;

    const date = new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="solodesk-quotation-${p.id.slice(0, 8)}.pdf"`
    );

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 58, bottom: 58, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: `Project Proposal - ${p.title}`,
        Author: "SoloDesk Intelligence",
        Subject: "Project proposal and change orders"
      }
    });

    doc.pipe(res);

    const pageWidth = doc.page.width;
    const left = 48;
    const right = pageWidth - 48;
    const contentWidth = right - left;
    const ink = "#172033";
    const muted = "#64748b";
    const accent = "#3448c5";
    const pale = "#f1f4ff";
    const line = "#dce2ec";

    function ensureSpace(height = 50) {
      if (doc.y + height > doc.page.height - 65) {
        doc.addPage();
      }
    }

    function heading(title, subtitle) {
      ensureSpace(65);
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(ink)
        .text(title, left, doc.y, { width: contentWidth });
      doc.moveDown(0.25);
      doc.moveTo(left, doc.y).lineTo(right, doc.y)
        .lineWidth(1).strokeColor(line).stroke();
      doc.moveDown(0.5);

      if (subtitle) {
        doc.font("Helvetica").fontSize(9).fillColor(muted)
          .text(subtitle, left, doc.y, { width: contentWidth });
        doc.moveDown(0.5);
      }
    }

    function tableHeader(columns) {
      ensureSpace(35);
      const y = doc.y;

      doc.rect(left, y, contentWidth, 25).fill(pale);

      columns.forEach(col => {
        doc.font("Helvetica-Bold").fontSize(8).fillColor(ink)
          .text(col.label, col.x, y + 8, {
            width: col.width,
            align: col.align || "left"
          });
      });

      doc.y = y + 31;
    }

    function drawRow(columns, values, options = {}) {
      const padding = 7;
      const startY = doc.y;
      const heights = values.map((value, i) => {
        const col = columns[i];
        return doc.font("Helvetica").fontSize(9)
          .heightOfString(String(value ?? "—"), {
            width: col.width,
            align: col.align || "left"
          });
      });

      const rowHeight = Math.max(20, ...heights) + padding * 2;

      if (startY + rowHeight > doc.page.height - 65) {
        doc.addPage();
        tableHeader(columns);
      }

      const y = doc.y;

      if (options.fill) {
        doc.rect(left, y - 2, contentWidth, rowHeight).fill(options.fill);
      }

      values.forEach((value, i) => {
        const col = columns[i];
        doc.font(options.bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .fillColor(ink)
          .text(String(value ?? "—"), col.x, y + padding, {
            width: col.width,
            align: col.align || "left"
          });
      });

      doc.y = y + rowHeight;
      doc.moveTo(left, doc.y).lineTo(right, doc.y)
        .lineWidth(0.5).strokeColor(line).stroke();
      doc.moveDown(0.15);
    }

    function bulletList(items) {
      if (!items?.length) return;

      for (const item of items) {
        ensureSpace(35);
        doc.font("Helvetica").fontSize(9).fillColor(ink)
          .text(`•  ${String(item)}`, left + 5, doc.y, {
            width: contentWidth - 10,
            lineGap: 3
          });
        doc.moveDown(0.3);
      }
    }

    // Document header
    doc.rect(0, 0, pageWidth, 115).fill(ink);

    doc.font("Helvetica-Bold").fontSize(21).fillColor("#ffffff")
      .text("SoloDesk Intelligence", left, 32);

    doc.font("Helvetica").fontSize(10).fillColor("#d8defe")
      .text("PROJECT PROPOSAL & QUOTATION", left, 63);

    doc.font("Helvetica").fontSize(9).fillColor("#ffffff")
      .text(`Issued ${date}`, left, 83);

    doc.y = 135;

    doc.font("Helvetica-Bold").fontSize(17).fillColor(ink)
      .text(p.title || "Untitled Project", left, doc.y, {
        width: contentWidth
      });

    doc.moveDown(0.6);

    const metaY = doc.y;
    const metaGap = 14;
    const metaWidth = (contentWidth - metaGap) / 2;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(muted)
      .text("CLIENT", left, metaY);

    doc.font("Helvetica").fontSize(10).fillColor(ink)
      .text(p.clientName || "Not specified", left, metaY + 13, {
        width: metaWidth
      });

    doc.font("Helvetica-Bold").fontSize(8).fillColor(muted)
      .text("CURRENCY", left + metaWidth + metaGap, metaY);

    doc.font("Helvetica").fontSize(10).fillColor(ink)
      .text(currency, left + metaWidth + metaGap, metaY + 13);

    doc.y = metaY + 42;

    heading("Project summary");
    doc.font("Helvetica").fontSize(10).fillColor(ink)
      .text(proposal.summary || "Project scope and estimates are listed below.", {
        width: contentWidth,
        lineGap: 4
      });

    // Original scope
    heading("1. Original proposal", "Original scope and estimates");

    const requirementColumns = [
      { label: "DELIVERABLE", x: left + 7, width: 340 },
      { label: "HOURS", x: right - 67, width: 60, align: "right" }
    ];

    tableHeader(requirementColumns);

    for (const item of requirements) {
      const hours = Math.max(0, Number(item.estimatedHours) || 0);
      drawRow(requirementColumns, [
        item.description || "Unnamed deliverable",
        hours.toLocaleString("en-IN")
      ]);
    }

    drawRow(
      requirementColumns,
      ["Total original effort", `${originalHours} hrs`],
      { bold: true, fill: pale }
    );

    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ink)
      .text(`Original estimate: ${money(originalCost)}`, {
        width: contentWidth,
        align: "right"
      });

    // Saved change orders
    heading(
      "2. Change orders",
      `${changeOrders.length} saved change order(s). Internal approval is not client approval.`
    );

    if (changeOrders.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor(muted)
        .text("No change orders have been saved for this project.", {
          width: contentWidth
        });
      doc.moveDown();
    } else {
      const orderColumns = [
        { label: "CHANGE REQUEST", x: left + 7, width: 205 },
        { label: "HOURS", x: left + 220, width: 48, align: "right" },
        { label: "EST. COST", x: left + 278, width: 105, align: "right" }
      ];

      tableHeader(orderColumns);

      for (const order of changeOrders) {
        const analysis = order.analysis || {};
        const items = analysis.items || [];

        const description = items.length
          ? items.map(item => item.request).filter(Boolean).join("; ")
          : order.notes || "Change request";

        const status = (order.status || "draft")
          .replace(/_/g, " ")
          .replace(/\b\w/g, char => char.toUpperCase());

        drawRow(orderColumns, [
          `${order.id ? `#${String(order.id).slice(0, 8)} — ` : ""}${description}\nStatus: ${status}`,
          `${orderHours(order)} hrs`,
          money(orderValue(order))
        ]);

        if (order.notes) {
          ensureSpace(30);
          doc.font("Helvetica-Oblique").fontSize(8).fillColor(muted)
            .text(`Notes: ${order.notes}`, left + 7, doc.y, {
              width: contentWidth - 14,
              lineGap: 2
            });
          doc.moveDown(0.5);
        }
      }
    }

    // Financial summary
    heading("3. Financial summary");

    const financialColumns = [
      { label: "DESCRIPTION", x: left + 7, width: 310 },
      { label: "AMOUNT", x: right - 135, width: 125, align: "right" }
    ];

    tableHeader(financialColumns);

    drawRow(financialColumns, [
      "Original proposal estimate",
      money(originalCost)
    ]);

    drawRow(financialColumns, [
      "Pending change orders (not client-approved)",
      money(pendingValue)
    ]);

    drawRow(financialColumns, [
      "Client-approved change orders",
      money(approvedValue)
    ]);

    drawRow(
      financialColumns,
      [
        "Current indicative value (original + client-approved changes)",
        money(originalCost + approvedValue)
      ],
      { bold: true, fill: pale }
    );

    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(8).fillColor(muted)
      .text(
        "Pending change-order amounts are excluded from the current indicative value until client approval is recorded. Estimates are not binding until mutually agreed.",
        { width: contentWidth, lineGap: 3 }
      );

    // Proposal details
    for (const [title, items] of [
      ["4. Assumptions", proposal.assumptions],
      ["5. Exclusions", proposal.exclusions],
      ["6. Open questions", proposal.questions]
    ]) {
      if (items?.length) {
        heading(title);
        bulletList(items);
      }
    }

    ensureSpace(80);
    heading("Terms and approval");
    doc.font("Helvetica").fontSize(9).fillColor(ink)
      .text(
        "This document contains indicative estimates for review. Confirm deliverables, rates, taxes, payment terms, schedule, and acceptance criteria before treating the quotation as binding.",
        { width: contentWidth, lineGap: 4 }
      );

    doc.moveDown(1.5);

    const signatureY = doc.y;
    const signatureWidth = (contentWidth - 30) / 2;

    doc.moveTo(left, signatureY + 25)
      .lineTo(left + signatureWidth, signatureY + 25)
      .strokeColor(line).stroke();

    doc.moveTo(left + signatureWidth + 30, signatureY + 25)
      .lineTo(right, signatureY + 25)
      .strokeColor(line).stroke();

    doc.font("Helvetica").fontSize(8).fillColor(muted)
      .text("Service provider", left, signatureY + 32)
      .text("Client approval", left + signatureWidth + 30, signatureY + 32);

    // Add consistent footer and page numbering to every page.
    const range = doc.bufferedPageRange();

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);

      const footerY = doc.page.height - 38;

      doc.moveTo(left, footerY - 8).lineTo(right, footerY - 8)
        .lineWidth(0.5).strokeColor(line).stroke();

      doc.font("Helvetica").fontSize(8).fillColor(muted)
        .text("SoloDesk Intelligence • Project Proposal", left, footerY, {
          lineBreak: false
        });

      doc.text(`Page ${i + 1} of ${range.count}`, left, footerY, {
        width: contentWidth,
        align: "right",
        lineBreak: false
      });
    }

    doc.end();
  } catch (error) {
    console.error("Quotation PDF generation failed:", error);

    if (!res.headersSent) {
      res.status(500).json({ error: "Could not generate quotation PDF" });
    } else {
      res.destroy(error);
    }
  }
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