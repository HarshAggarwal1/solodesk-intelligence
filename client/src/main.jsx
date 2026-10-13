import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Download,
  FileText,
  FolderKanban,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
  Menu,
  LayoutDashboard,
  BriefcaseBusiness,
  ChevronRight,
  Sun,
  Moon,
  Ban,
} from "lucide-react";
import "./styles.css";

const API = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(
  /\/+$/,
  "",
);
async function request(path, options = {}) {
  const token = localStorage.getItem("solodesk_token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = options.raw ? res : await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data.message || data.error || `Request failed (${res.status})`,
    );
  return data;
}
const money = (n, c = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
const classLabel = {
  already_in_scope: "Already in scope",
  additional_work: "Additional work",
  ambiguous: "Needs review",
  conflicting: "Potential conflict",
};
const PROJECT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "planning", label: "Planning" },
  { value: "proposal_sent", label: "Proposal sent" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "archived", label: "Archived" },
];
const CHART_TYPES = [
  { value: "status", label: "Project status distribution" },
  { value: "requirements", label: "Requirements by project" },
  { value: "changes", label: "Change orders by project" },
  { value: "effort", label: "Estimated hours by project" },
  { value: "readiness", label: "Proposal and baseline readiness" },
];

function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem("solodesk_token") || "",
  );
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    title: "Website redesign",
    clientName: "Sample client",
    currency: "INR",
    hourlyRate: 1500,
    brief: "Build a responsive React website with a landing page, login, dashboard, contact form, and payment integration. Include mobile layouts and basic accessibility. Target delivery is three weeks. Hosting and post-launch maintenance are not yet agreed.",
  });
  const [changeText, setChangeText] = useState(
    "The client now wants an admin analytics dashboard and email notifications for every payment.",
  );
  const [analysis, setAnalysis] = useState(null);
  const [notes, setNotes] = useState("");
  const [health, setHealth] = useState(null);
  const [activePage, setActivePage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("solodesk_theme") || "dark",
  );
  const [dashboardCharts, setDashboardCharts] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("solodesk_charts")) || [
          "status",
          "requirements",
          "readiness",
        ]
      );
    } catch {
      return ["status", "requirements", "readiness"];
    }
  });
  const [chartToAdd, setChartToAdd] = useState("changes");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("solodesk_theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem(
      "solodesk_charts",
      JSON.stringify(dashboardCharts),
    );
  }, [dashboardCharts]);

  async function refresh(id) {
    const list = await request("/api/projects");
    setProjects(list);
    const target = id || selected?.id || list[0]?.id;
    if (target) {
      const p = await request(`/api/projects/${target}`);
      setSelected(p);
    } else setSelected(null);
  }
  useEffect(() => {
    (async () => {
      try {
        const h = await request("/api/health");
        setHealth(h);
        if (token) await refresh();
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  async function authenticate(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await request(`/api/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify(authForm),
      });
      localStorage.setItem("solodesk_token", data.token);
      setToken(data.token);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function signOut() {
    localStorage.removeItem("solodesk_token");
    setToken("");
    setSelected(null);
    setProjects([]);
    setAnalysis(null);
    setNotice("");
  }
  async function act(fn, success) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      await refresh(selected?.id);
      if (success) setNotice(success(result));
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function create(e) {
    e.preventDefault();
    const p = await act(
      () =>
        request("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            ...form,
            hourlyRate: Number(form.hourlyRate),
          }),
        }),
      () => "Project created.",
    );
    if (p) {
      setShowNew(false);
      setActivePage("project");
      await refresh(p.id);
    }
  }
  async function generate() {
    await act(
      () =>
        request(`/api/projects/${selected.id}/proposal`, {
          method: "POST",
          body: "{}",
        }),
      () =>
        "Proposal generated. Review it before approving the baseline.",
    );
    setAnalysis(null);
  }
  async function baseline() {
    await act(
      () =>
        request(`/api/projects/${selected.id}/baseline`, {
          method: "POST",
          body: "{}",
        }),
      () => "Scope baseline approved and versioned.",
    );
  }
  async function setProjectStatus(project, status) {
    const updated = await act(
      () =>
        request(`/api/projects/${project.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      () => `Project marked ${status}.`,
    );
    if (updated) {
      setSelected(updated);
      setActivePage("project");
    }
  }
  async function analyze(e) {
    e.preventDefault();
    const a = await act(
      () =>
        request(`/api/projects/${selected.id}/analyze-change`, {
          method: "POST",
          body: JSON.stringify({ request: changeText }),
        }),
      () => "Change analysis complete. Review each classification.",
    );
    if (a) setAnalysis(a);
  }
  async function saveOrder() {
    if (!analysis) return;
    await act(
      () =>
        request(`/api/projects/${selected.id}/change-orders`, {
          method: "POST",
          body: JSON.stringify({ analysis, notes }),
        }),
      () => "Draft change order saved.",
    );
  }

  async function approveOrder(orderId) {
    await act(
      () =>
        request(
          `/api/projects/${selected.id}/change-orders/${orderId}/approve`,
          { method: "POST", body: "{}" },
        ),
      () => "Change order approved internally.",
    );
  }

  
  
  async function sendForApproval(orderId) {
      const result = await act(
          () =>
              request(
                  `/api/projects/${selected.id}/change-orders/${orderId}/send-for-approval`,
                  { method: "POST", body: "{}" },
              ),
          () => "Approval link generated.",
      );

      if (result?.approvalUrl) {
          try {
              await navigator.clipboard.writeText(result.approvalUrl);
              setNotice("Approval link copied to clipboard. You can now share it with your client.");
          } catch {
              window.prompt(
                  "Automatic copying failed. Copy this approval link:",
                  result.approvalUrl,
              );
          }
      }
  }



  async function downloadPdf() {
    try {
      setBusy(true);
      const res = await fetch(
        `${API}/api/projects/${selected.id}/quotation.pdf`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("solodesk_token") || ""}`,
          },
        },
      );
      if (!res.ok) throw new Error("Could not create PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `solodesk-${selected.id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const totalHours = useMemo(
    () =>
      selected?.proposal?.requirements?.reduce(
        (sum, r) => sum + (Number(r.estimatedHours) || 0),
        0,
      ) || 0,
    [selected],
  );

  const totalCost = totalHours * (selected?.hourlyRate || 0);

  const pendingChangeValue = (selected?.changeOrders || [])
    .filter((order) =>
      ["draft", "internally_approved", "sent_to_client"].includes(
        order.status,
      ),
    )
    .reduce((sum, order) => sum + (Number(order.estimatedCost) || 0), 0);

  const acceptedChangeValue = (selected?.changeOrders || [])
    .filter((order) => order.status === "client_approved")
    .reduce((sum, order) => sum + (Number(order.estimatedCost) || 0), 0);

  const currentIndicativeValue = totalCost + acceptedChangeValue;

  const approvalMatch = window.location.pathname.match(
      /^\/client-approval\/([a-f0-9]{64})\/?$/
  );

  if (approvalMatch) {
      return <ClientApprovalPage token={approvalMatch[1]} />;
  }

  if (loading)
    return <div className="loading">Loading SoloDesk Intelligence…</div>;
  if (!token)
    return (
      <div className="client-approval-page">
        <div className="client-approval-card card">
          <div className="brand auth-brand">
            <div className="brand-mark">
              <Sparkles size={20} />
            </div>
            <div>
              <strong>SoloDesk</strong>
              <span>INTELLIGENCE</span>
            </div>
          </div>
          <div className="eyebrow">FREELANCER OPERATIONS AGENT</div>
          <h1>
            {authMode === "login"
              ? "Welcome back"
              : "Create your workspace"}
          </h1>
          <p>
            Manage proposals, approved scope, and client change
            requests.
          </p>
          {error && <div className="alert error">{error}</div>}
          <form onSubmit={authenticate} className="new-form">
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={authForm.email}
                onChange={(e) =>
                  setAuthForm({
                    ...authForm,
                    email: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={
                  authMode === "login"
                    ? "current-password"
                    : "new-password"
                }
                minLength="10"
                required
                value={authForm.password}
                onChange={(e) =>
                  setAuthForm({
                    ...authForm,
                    password: e.target.value,
                  })
                }
              />
              <small>Use at least 10 characters.</small>
            </label>
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : authMode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
          <p className="auth-switch">
            {authMode === "login"
              ? "New to SoloDesk?"
              : "Already have an account?"}{" "}
            <button
              onClick={() => {
                setAuthMode(
                  authMode === "login" ? "register" : "login",
                );
                setError("");
              }}
            >
              {authMode === "login"
                ? "Create account"
                : "Sign in"}
            </button>
          </p>
          <small className="auth-warning">
            Prototype security: use a unique password. This MVP uses
            bearer tokens; before handling sensitive client data,
            add rate limiting, password reset, email verification,
            and stronger session management.
          </small>
        </div>
      </div>
    );

  const openProject = async (id) => {
    setError("");
    setAnalysis(null);
    setActivePage("project");
    setSidebarOpen(false);
    setSelected(await request(`/api/projects/${id}`));
  };
  const navigate = (page) => {
    setActivePage(page);
    setSidebarOpen(false);
    setError("");
  };
  const totalProjects = projects.length;
  const proposalCount = projects.filter((p) => p.proposal).length;
  const baselineCount = projects.filter((p) => p.baseline).length;
  const changeOrderCount = projects.reduce(
    (sum, p) => sum + (p.changeOrders?.length || 0),
    0,
  );

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>
          <div>
            <strong>SoloDesk</strong>
            <span>INTELLIGENCE</span>
          </div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <button
          className={`nav ${activePage === "dashboard" ? "active" : ""}`}
          onClick={() => navigate("dashboard")}
        >
          <LayoutDashboard size={17} /> Dashboard
        </button>
        <button
          className={`nav ${activePage === "workspace" ? "active" : ""}`}
          onClick={() => navigate("workspace")}
        >
          <FolderKanban size={17} /> All projects{" "}
          <span>{projects.length}</span>
        </button>
        <div className="side-label projects-label">
          YOUR PROJECTS{" "}
          <button
            className="icon-button"
            onClick={() => setShowNew(true)}
            aria-label="New project"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="project-list">
          {projects.slice(0, 8).map((p) => (
            <button
              key={p.id}
              className={`project-link ${selected?.id === p.id && activePage === "project" ? "chosen" : ""}`}
              onClick={() => openProject(p.id)}
            >
              <span className="project-dot" />
              <span className="project-name">{p.title}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="status-icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <strong>Human-approved workflow</strong>
            <p>AI drafts. You decide.</p>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <b>
              {activePage === "dashboard"
                ? "Dashboard"
                : activePage === "workspace"
                  ? "All projects"
                  : selected?.title || "Project"}
            </b>
          </div>
          <div className="top-right">
            <button
              className="theme-toggle"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              onClick={() =>
                setTheme(theme === "dark" ? "light" : "dark")
              }
            >
              {theme === "dark" ? (
                <Sun size={16} />
              ) : (
                <Moon size={16} />
              )}
            </button>
            <span
              className={`status-pill ${health?.aiConfigured ? "live" : "demo"}`}
            >
              <i />{" "}
              {health?.aiConfigured
                ? "AI connected"
                : "Demo mode"}
            </span>
            <button className="signout" onClick={signOut}>
              Sign out
            </button>
            <div className="avatar">SD</div>
          </div>
        </header>
        <div className="content">
          {activePage === "dashboard" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    YOUR OPERATIONS OVERVIEW
                  </div>
                  <h1>Dashboard</h1>
                  <p>
                    A clear view of your projects,
                    proposals, and scope changes.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setShowNew(true)}
                >
                  <Plus size={17} /> New project
                </button>
              </div>
              {error && (
                <div className="alert error">
                  <CircleAlert size={18} />
                  <span>{error}</span>
                  <button onClick={() => setError("")}>
                    <X size={16} />
                  </button>
                </div>
              )}
              {notice && (
                <div className="alert success">
                  <CheckCircle2 size={18} />
                  <span>{notice}</span>
                  <button onClick={() => setNotice("")}>
                    <X size={16} />
                  </button>
                </div>
              )}

              <div className="metrics dashboard-metrics">
                <Metric
                  icon={<BriefcaseBusiness size={18} />}
                  label="Total projects"
                  value={totalProjects}
                  detail="Across your workspace"
                />
                <Metric
                  icon={<FileText size={18} />}
                  label="Proposals created"
                  value={proposalCount}
                  detail="Generated drafts"
                />
                <Metric
                  icon={<ShieldCheck size={18} />}
                  label="Approved baselines"
                  value={baselineCount}
                  detail="Versioned project scopes"
                />
                <Metric
                  icon={<Activity size={18} />}
                  label="Saved change orders"
                  value={changeOrderCount}
                  detail={`${projects.reduce((sum, p) => sum + (p.changeOrders || []).filter((o) => o.status === "draft").length, 0)} drafts · ${projects.reduce((sum, p) => sum + (p.changeOrders || []).filter((o) => o.status === "internally_approved").length, 0)} internally approved`}
                />
              </div>

              <section className="card dashboard-welcome">
                <div className="welcome-copy">
                  <div className="eyebrow">GET STARTED</div>
                  <h2>
                    From client brief to controlled scope
                  </h2>
                  <p>
                    Create a project, turn the brief into a
                    proposal, then compare future requests
                    against an approved baseline.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setShowNew(true)}
                  >
                    <Plus size={16} /> Create a project
                  </button>
                </div>
                <div className="welcome-illustration">
                  <div className="welcome-icon">
                    <Sparkles size={28} />
                  </div>
                  <div className="welcome-line line-one" />
                  <div className="welcome-line line-two" />
                  <div className="welcome-line line-three" />
                </div>
              </section>
              <section className="card chart-controls">
                <div>
                  <div className="eyebrow">
                    CUSTOMIZE DASHBOARD
                  </div>
                  <h2>Analytics widgets</h2>
                  <p>
                    Add or remove charts. Your layout is
                    saved in this browser.
                  </p>
                </div>
                <div className="chart-add">
                  <select
                    value={chartToAdd}
                    onChange={(e) =>
                      setChartToAdd(e.target.value)
                    }
                    aria-label="Choose graph to add"
                  >
                    {CHART_TYPES.filter(
                      (c) =>
                        !dashboardCharts.includes(
                          c.value,
                        ),
                    ).map((c) => (
                      <option
                        key={c.value}
                        value={c.value}
                      >
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary"
                    disabled={
                      dashboardCharts.length >=
                      CHART_TYPES.length ||
                      dashboardCharts.includes(chartToAdd)
                    }
                    onClick={() =>
                      setDashboardCharts((v) => [
                        ...v,
                        chartToAdd,
                      ])
                    }
                  >
                    <Plus size={15} /> Add graph
                  </button>
                </div>
              </section>
              {dashboardCharts.length === 0 ? (
                <div className="card chart-empty dashboard-no-charts">
                  No graphs selected. Add one using the
                  controls above.
                </div>
              ) : (
                <div className="analytics-grid configurable-charts">
                  {dashboardCharts.map((type) => (
                    <ChartWidget
                      key={type}
                      type={type}
                      projects={projects}
                      onRemove={() =>
                        setDashboardCharts((v) =>
                          v.filter((x) => x !== type),
                        )
                      }
                    />
                  ))}
                </div>
              )}
              <section className="card">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">
                      RECENT ACTIVITY
                    </div>
                    <h2>Recent projects</h2>
                    <p>
                      Open a project to continue working.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("workspace")}
                  >
                    View all projects{" "}
                    <ChevronRight size={15} />
                  </button>
                </div>
                {projects.length === 0 ? (
                  <div className="empty-inline">
                    <FolderKanban size={22} />
                    <div>
                      <strong>No projects yet</strong>
                      <p>
                        Create your first project to
                        start using SoloDesk.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="project-grid">
                    {projects.slice(0, 6).map((p) => (
                      <button
                        className="project-card"
                        key={p.id}
                        onClick={() =>
                          openProject(p.id)
                        }
                      >
                        <div className="project-card-top">
                          <span className="project-card-icon">
                            <FileText size={17} />
                          </span>
                          <ChevronRight size={16} />
                        </div>
                        <strong>{p.title}</strong>
                        <span className="project-client">
                          {p.clientName ||
                            "No client specified"}
                        </span>
                        <div className="project-card-bottom">
                          <span
                            className={`mini-status ${p.status || "active"}`}
                          >
                            {PROJECT_STATUSES.find(
                              (s) =>
                                s.value ===
                                (p.status ||
                                  "active"),
                            )?.label ||
                              (p.baseline
                                ? "Baseline approved"
                                : p.proposal
                                  ? "Proposal ready"
                                  : "Active")}
                          </span>
                          <span>
                            {new Date(
                              p.updatedAt ||
                              p.createdAt,
                            ).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : activePage === "workspace" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    PROJECT MANAGEMENT
                  </div>
                  <h1>All projects</h1>
                  <p>
                    Manage every client brief, proposal, and
                    approved scope in one place.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setShowNew(true)}
                >
                  <Plus size={17} /> New project
                </button>
              </div>
              {error && (
                <div className="alert error">
                  <CircleAlert size={18} />
                  <span>{error}</span>
                  <button onClick={() => setError("")}>
                    <X size={16} />
                  </button>
                </div>
              )}
              {projects.length === 0 ? (
                <div className="empty card">
                  <div className="empty-icon">
                    <FolderKanban size={24} />
                  </div>
                  <h2>No projects yet</h2>
                  <p>
                    Create a project to generate a proposal
                    and track scope changes.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setShowNew(true)}
                  >
                    <Plus size={17} /> Create first project
                  </button>
                </div>
              ) : (
                <div className="project-grid workspace-grid">
                  {projects.map((p) => (
                    <button
                      className="project-card"
                      key={p.id}
                      onClick={() => openProject(p.id)}
                    >
                      <div className="project-card-top">
                        <span className="project-card-icon">
                          <FileText size={17} />
                        </span>
                        <ChevronRight size={16} />
                      </div>
                      <strong>{p.title}</strong>
                      <span className="project-client">
                        {p.clientName ||
                          "No client specified"}
                      </span>
                      <div className="project-card-meta">
                        <span>
                          {p.proposal?.requirements
                            ?.length || 0}{" "}
                          requirements
                        </span>
                        <span>
                          {p.changeOrders?.length ||
                            0}{" "}
                          change orders
                        </span>
                      </div>
                      <div className="project-card-bottom">
                        <span
                          className={`mini-status ${p.status || "active"}`}
                        >
                          {PROJECT_STATUSES.find(
                            (s) =>
                              s.value ===
                              (p.status ||
                                "active"),
                          )?.label ||
                            (p.baseline
                              ? "Baseline approved"
                              : p.proposal
                                ? "Proposal ready"
                                : "Active")}
                        </span>
                        <span>
                          {new Date(
                            p.updatedAt ||
                            p.createdAt,
                          ).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    FREELANCER OPERATIONS AGENT
                  </div>
                  <h1>
                    {selected?.title ||
                      "Your project workspace"}
                  </h1>
                  <p>
                    Turn client requests into clear scope,
                    estimates, and controlled change orders.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setShowNew(true)}
                >
                  <Plus size={17} /> New project
                </button>
              </div>
              {selected && (
                <section className="card project-status-panel">
                  <div>
                    <div className="eyebrow">
                      PROJECT STATUS
                    </div>
                    <h2>
                      {PROJECT_STATUSES.find(
                        (s) =>
                          s.value ===
                          (selected.status ||
                            "active"),
                      )?.label || "Active"}{" "}
                      project
                    </h2>
                    <p>
                      Track the engagement from draft and
                      planning through delivery, pause,
                      cancellation, or archive.
                    </p>
                  </div>
                  <div className="status-actions">
                    <span
                      className={`status-badge ${selected.status || "active"}`}
                    >
                      {PROJECT_STATUSES.find(
                        (s) =>
                          s.value ===
                          (selected.status ||
                            "active"),
                      )?.label || "Active"}
                    </span>
                    <select
                      aria-label="Change project status"
                      value={selected.status || "active"}
                      disabled={busy}
                      onChange={(e) =>
                        setProjectStatus(
                          selected,
                          e.target.value,
                        )
                      }
                    >
                      {PROJECT_STATUSES.map((status) => (
                        <option
                          key={status.value}
                          value={status.value}
                        >
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </section>
              )}
              {error && (
                <div className="alert error">
                  <CircleAlert size={18} />
                  <span>{error}</span>
                  <button onClick={() => setError("")}>
                    <X size={16} />
                  </button>
                </div>
              )}
              {notice && (
                <div className="alert success">
                  <CheckCircle2 size={18} />
                  <span>{notice}</span>
                  <button onClick={() => setNotice("")}>
                    <X size={16} />
                  </button>
                </div>
              )}

              {!selected ? (
                <div className="empty card">
                  <div className="empty-icon">
                    <FolderKanban size={24} />
                  </div>
                  <h2>No projects yet</h2>
                  <p>
                    Create a project to generate a proposal
                    and test scope changes.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setShowNew(true)}
                  >
                    <Plus size={17} /> Create first project
                  </button>
                </div>
              ) : (
                <>
                  <div className="metrics">
                    <Metric
                      icon={<FileText size={18} />}
                      label="Scope requirements"
                      value={
                        selected.proposal?.requirements
                          ?.length ?? "—"
                      }
                      detail={
                        selected.proposal
                          ? "Draft generated"
                          : "Generate a proposal"
                      }
                    />
                    <Metric
                      icon={<Clock3 size={18} />}
                      label="Estimated effort"
                      value={
                        selected.proposal
                          ? `${totalHours} hrs`
                          : "—"
                      }
                      detail="Review AI estimates"
                    />
                    <Metric
                      icon={<Activity size={18} />}
                      label="Indicative value"
                      value={
                        selected.proposal
                          ? money(
                            totalCost,
                            selected.currency,
                          )
                          : "—"
                      }
                      detail={`Rate: ${money(selected.hourlyRate, selected.currency)}/hr`}
                    />
                    <Metric
                      icon={<ShieldCheck size={18} />}
                      label="Scope baseline"
                      value={
                        selected.baseline
                          ? `v${selected.baseline.version}`
                          : "Not approved"
                      }
                      detail={
                        selected.baseline
                          ? "Versioned baseline"
                          : "Approve after review"
                      }
                    />
                  </div>

                  <section
                    className={`card workflow-card ${(selected.status || "active") === "cancelled" ? "cancelled-workflow" : ""}`}
                  >
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">
                          WORKFLOW
                        </div>
                        <h2>
                          From brief to controlled
                          scope
                        </h2>
                      </div>
                      <span className="step-count">
                        3 steps
                      </span>
                    </div>
                    <div className="workflow">
                      <Step
                        n="01"
                        title="Generate proposal"
                        text="Extract deliverables, assumptions, and open questions."
                        done={Boolean(
                          selected.proposal,
                        )}
                      />
                      <div className="step-line" />
                      <Step
                        n="02"
                        title="Approve baseline"
                        text="Lock the reviewed requirements as the reference scope."
                        done={Boolean(
                          selected.baseline,
                        )}
                      />
                      <div className="step-line" />
                      <Step
                        n="03"
                        title="Analyze changes"
                        text="Compare new requests and draft change orders."
                        done={Boolean(
                          selected.changeOrders
                            ?.length,
                        )}
                      />
                    </div>
                    <div className="action-row">
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          (selected.status ||
                            "active") ===
                          "cancelled"
                        }
                        onClick={generate}
                      >
                        <Sparkles size={16} />
                        {selected.proposal
                          ? "Regenerate proposal"
                          : "Generate proposal"}
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          !selected.proposal ||
                          (selected.status ||
                            "active") ===
                          "cancelled"
                        }
                        onClick={baseline}
                      >
                        <CheckCircle2 size={16} />{" "}
                        Approve baseline
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          busy || !selected.proposal
                        }
                        onClick={downloadPdf}
                      >
                        <Download size={16} /> Export
                        PDF
                      </button>
                    </div>
                  </section>

                  {selected.proposal && (
                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <div className="eyebrow">
                            PROPOSAL DRAFT
                          </div>
                          <h2>
                            {
                              selected.proposal
                                .title
                            }
                          </h2>
                        </div>
                        <span className="tag">
                          {selected.proposal.model ||
                            "AI draft"}
                        </span>
                      </div>
                      <p className="summary">
                        {selected.proposal.summary}
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>
                                Deliverable /
                                requirement
                              </th>
                              <th>Category</th>
                              <th>Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selected.proposal.requirements.map(
                              (r, i) => (
                                <tr
                                  key={
                                    r.id ||
                                    i
                                  }
                                >
                                  <td>
                                    {
                                      r.description
                                    }
                                  </td>
                                  <td>
                                    <span className="tag neutral">
                                      {
                                        r.category
                                      }
                                    </span>
                                  </td>
                                  <td>
                                    {
                                      r.estimatedHours
                                    }
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="detail-grid">
                        <Detail
                          title="Assumptions"
                          items={
                            selected.proposal
                              .assumptions
                          }
                        />
                        <Detail
                          title="Exclusions"
                          items={
                            selected.proposal
                              .exclusions
                          }
                        />
                        <Detail
                          title="Questions to resolve"
                          items={
                            selected.proposal
                              .questions
                          }
                        />
                      </div>
                    </section>
                  )}

                  <section className="card">
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">
                          SCOPE INTELLIGENCE
                        </div>
                        <h2>
                          Analyze a new client request
                        </h2>
                        <p>
                          Approve a baseline first for
                          the most meaningful
                          comparison.
                        </p>
                      </div>
                      <div className="scope-icon">
                        <Activity size={20} />
                      </div>
                    </div>
                    <form
                      onSubmit={analyze}
                      className="change-form"
                    >
                      <label htmlFor="change">
                        New request from client
                      </label>
                      <textarea
                        id="change"
                        value={changeText}
                        onChange={(e) =>
                          setChangeText(
                            e.target.value,
                          )
                        }
                        minLength={5}
                        required
                        placeholder="Paste the client's new request…"
                      />
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          !selected.proposal ||
                          (selected.status ||
                            "active") ===
                          "cancelled"
                        }
                      >
                        <Sparkles size={16} /> Analyze
                        scope change{" "}
                        <ArrowRight size={16} />
                      </button>
                    </form>
                    {analysis && (
                      <div className="analysis-result">
                        <div className="result-head">
                          <div>
                            <h3>Change analysis</h3>
                            <p>
                              {analysis.summary}
                            </p>
                          </div>
                          <span className="tag">
                            Draft · Review required
                          </span>
                        </div>
                        {analysis.items.map((item) => (
                          <div
                            className="change-item"
                            key={item.id}
                          >
                            <div className="change-main">
                              <span
                                className={`class-dot ${item.classification}`}
                              />
                              <div>
                                <strong>
                                  {
                                    item.request
                                  }
                                </strong>
                                <p>
                                  {
                                    item.reason
                                  }
                                </p>
                                {item.matchedRequirement && (
                                  <small>
                                    Closest
                                    baseline
                                    match:{" "}
                                    {
                                      item.matchedRequirement
                                    }
                                  </small>
                                )}
                              </div>
                            </div>
                            <div
                              className={`classification ${item.classification}`}
                            >
                              {
                                classLabel[
                                item
                                  .classification
                                ]
                              }
                            </div>
                          </div>
                        ))}
                        {analysis.questions?.length >
                          0 && (
                            <div className="questions">
                              <strong>
                                Questions to resolve
                              </strong>
                              {analysis.questions.map(
                                (q, i) => (
                                  <p key={i}>
                                    • {q}
                                  </p>
                                ),
                              )}
                            </div>
                          )}
                        <label className="notes-label">
                          Notes for change order
                          (optional)
                        </label>
                        <textarea
                          className="notes-input"
                          value={notes}
                          onChange={(e) =>
                            setNotes(e.target.value)
                          }
                          placeholder="Add assumptions, delivery impact, or payment terms…"
                        />
                        <div className="order-summary">
                          <div>
                            <span>
                              Potential extra
                              hours
                            </span>
                            <strong>
                              {analysis.items
                                .filter(
                                  (i) =>
                                    i.classification ===
                                    "additional_work",
                                )
                                .reduce(
                                  (s, i) =>
                                    s +
                                    Number(
                                      i.estimatedAdditionalHours ||
                                      0,
                                    ),
                                  0,
                                )}
                            </strong>
                          </div>
                          <div>
                            <span>
                              Indicative extra
                              cost
                            </span>
                            <strong>
                              {money(
                                analysis.items
                                  .filter(
                                    (i) =>
                                      i.classification ===
                                      "additional_work",
                                  )
                                  .reduce(
                                    (
                                      s,
                                      i,
                                    ) =>
                                      s +
                                      Number(
                                        i.estimatedAdditionalHours ||
                                        0,
                                      ),
                                    0,
                                  ) *
                                selected.hourlyRate,
                                selected.currency,
                              )}
                            </strong>
                          </div>
                          <button
                            className="primary"
                            onClick={saveOrder}
                            disabled={busy}
                          >
                            Save draft change order
                          </button>
                        </div>
                      </div>
                    )}
                  </section>

                  {selected.changeOrders?.length > 0 && (
                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <div className="eyebrow">
                            CHANGE HISTORY
                          </div>
                          <h2>Saved change orders</h2>
                        </div>
                        <span className="tag neutral">
                          {
                            selected.changeOrders
                              .length
                          }{" "}
                          orders
                        </span>
                      </div>

                      {selected.changeOrders.map((o) => {
                        const statusLabels = {
                            draft: "Draft",
                            internally_approved: "Internally approved",
                            sent_to_client: "Awaiting client",
                            client_approved: "Client approved",
                            client_rejected: "Client rejected",
                        };

                        const statusClass =
                            o.status === "internally_approved" ||
                            o.status === "client_approved"
                                ? "success"
                                : "demo";

                        return (
                          <div
                            className="history-row"
                            key={o.id}
                          >
                            <div>
                              <strong>
                                Change order ·{" "}
                                {new Date(
                                  o.createdAt,
                                ).toLocaleDateString()}
                              </strong>
                              <p>
                                {o.extraHours}{" "}
                                additional hours
                                ·{" "}
                                {money(
                                  o.estimatedCost,
                                  selected.currency,
                                )}
                              </p>
                              {o.internallyApprovedAt && (
                                  <small>
                                    Internally
                                    approved
                                    on{" "}
                                    {new Date(
                                      o.internallyApprovedAt,
                                    ).toLocaleDateString()}
                                  </small>
                                )}
                            </div>

                            <div className="order-actions">
                              <span className={`status-pill ${statusClass}`}>
                                  {statusLabels[o.status] || o.status}
                              </span>

                              {o.status ===
                                "draft" && (
                                  <button
                                    className="primary"
                                    disabled={
                                      busy
                                    }
                                    onClick={() =>
                                      approveOrder(
                                        o.id,
                                      )
                                    }
                                  >
                                    Approve
                                    internally
                                  </button>
                                )}                                
                                {o.status === "internally_approved" && (
                                    <button
                                        className="primary"
                                        disabled={busy}
                                        onClick={() => sendForApproval(o.id)}
                                    >
                                        Send for client approval
                                    </button>
                                )}

                                {o.status === "sent_to_client" && (
                                    <span className="status-pill demo">
                                        Awaiting client
                                    </span>
                                )}

                                {o.status === "client_approved" && (
                                    <span className="status-pill success">
                                        Client approved
                                    </span>
                                )}

                                {o.status === "client_rejected" && (
                                    <span className="status-pill demo">
                                        Client rejected
                                    </span>
                                )}
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  )}

                  <section className="footnote">
                    <ShieldCheck size={16} />
                    <span>
                      Review all AI classifications and
                      estimates. Nothing is sent to a
                      client automatically.{" "}
                      {health?.storage === "local-json"
                        ? "Local JSON storage is for development only."
                        : "Project data is stored in the configured database."}
                    </span>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </main>

      {showNew && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowNew(false);
          }}
        >
          <div className="modal card">
            <div className="modal-head">
              <div>
                <div className="eyebrow">NEW WORKSPACE</div>
                <h2>Create a project</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowNew(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={create} className="new-form">
              <label>
                Project name
                <input
                  required
                  minLength="2"
                  maxLength="120"
                  value={form.title}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      title: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Client name
                <input
                  value={form.clientName}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      clientName: e.target.value,
                    })
                  }
                  placeholder="Client or company"
                />
              </label>
              <div className="form-two">
                <label>
                  Currency
                  <select
                    value={form.currency}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        currency: e.target.value,
                      })
                    }
                  >
                    <option value="INR">
                      INR — Indian Rupee
                    </option>
                    <option value="USD">
                      USD — US Dollar
                    </option>
                    <option value="EUR">EUR — Euro</option>
                    <option value="GBP">
                      GBP — Pound Sterling
                    </option>
                  </select>
                </label>
                <label>
                  Hourly rate
                  <input
                    type="number"
                    min="0"
                    value={form.hourlyRate}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        hourlyRate: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Client brief
                <textarea
                  required
                  minLength="10"
                  maxLength="20000"
                  rows="5"
                  value={form.brief}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      brief: e.target.value,
                    })
                  }
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowNew(false)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  <Plus size={16} /> Create project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientApprovalPage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`${API}/api/client-approval/${token}`)
      .then(async (res) => {
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(result.error || "Unable to load approval.");
        }
        return result;
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);

  async function decide(decision) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch(
        `${API}/api/client-approval/${token}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || "Unable to record decision.");
      }

      setData((current) => ({
        ...current,
        decision: result.decision,
        changeOrder: {
          ...current.changeOrder,
          status: result.decision,
        },
      }));

      setMessage(
        decision === "client_approved"
          ? "You approved this change order."
          : "You rejected this change order.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const order = data?.changeOrder;
  const decisionRecorded =
    Boolean(data?.decision) ||
    ["client_approved", "client_rejected"].includes(order?.status);

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="brand auth-brand">
          <div className="brand-mark">
            <FileText size={20} />
          </div>
          <div>
            <strong>SoloDesk</strong>
            <span>CLIENT APPROVAL</span>
          </div>
        </div>

        <h1>Review change order</h1>

        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}

        {!data && !error && <p>Loading change order…</p>}

        {data && (
          <>
            <p>
              Project: <strong>{data.projectTitle}</strong>
            </p>
            <p>
              Prepared for: <strong>{data.clientName || "Client"}</strong>
            </p>

            <div className="card">
              <h2>Additional work</h2>
              <p>
                Estimated additional hours:{" "}
                <strong>{order.extraHours}</strong>
              </p>
              <p>
                Estimated additional cost:{" "}
                <strong>
                  {money(order.estimatedCost, data.currency)}
                </strong>
              </p>

              {order.notes && <p>{order.notes}</p>}

              <h3>Requested changes</h3>
              {order.items?.length ? (
                order.items.map((item, index) => (
                  <div key={index}>
                    <p><strong>{item.request}</strong></p>
                    <small>
                      {classLabel[item.classification] ||
                        item.classification}
                      {item.estimatedAdditionalHours != null
                        ? ` · ${item.estimatedAdditionalHours} additional hours`
                        : ""}
                    </small>
                  </div>
                ))
              ) : (
                <p>See the change order details above.</p>
              )}
            </div>

            {decisionRecorded ? (
              <p>
                Decision recorded:{" "}
                <strong>
                  {data.decision || order.status}
                </strong>
              </p>
            ) : (
              <>
                <p>
                  Review the scope and estimated cost before
                  recording your decision.
                </p>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => decide("client_rejected")}
                  >
                    Reject
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => decide("client_approved")}
                  >
                    {busy ? "Recording…" : "Accept change order"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function ChartWidget({ type, projects, onRemove }) {
  const configs = {
    status: {
      title: "Project status distribution",
      eyebrow: "PORTFOLIO STATUS",
    },
    requirements: {
      title: "Requirements by project",
      eyebrow: "WORKLOAD OVERVIEW",
    },
    changes: {
      title: "Change orders by project",
      eyebrow: "SCOPE CHANGES",
    },
    effort: {
      title: "Estimated hours by project",
      eyebrow: "EFFORT ESTIMATE",
    },
    readiness: {
      title: "Proposal and baseline readiness",
      eyebrow: "PROJECT READINESS",
    },
  };
  const rows = useMemo(() => {
    if (type === "status")
      return PROJECT_STATUSES.map((s) => ({
        label: s.label,
        value: projects.filter(
          (p) => (p.status || "active") === s.value,
        ).length,
      })).filter((x) => x.value > 0);
    if (type === "requirements")
      return projects
        .map((p) => ({
          label: p.title,
          value: p.proposal?.requirements?.length || 0,
        }))
        .filter((x) => x.value > 0)
        .slice(0, 8);
    if (type === "changes")
      return projects
        .map((p) => ({
          label: p.title,
          value: p.changeOrders?.length || 0,
        }))
        .filter((x) => x.value > 0)
        .slice(0, 8);
    if (type === "effort")
      return projects
        .map((p) => ({
          label: p.title,
          value: (p.proposal?.requirements || []).reduce(
            (sum, r) => sum + (Number(r.estimatedHours) || 0),
            0,
          ),
        }))
        .filter((x) => x.value > 0)
        .slice(0, 8);
    return [
      {
        label: "Proposal created",
        value: projects.filter((p) => p.proposal).length,
      },
      {
        label: "Baseline approved",
        value: projects.filter((p) => p.baseline).length,
      },
      {
        label: "Has change orders",
        value: projects.filter((p) => (p.changeOrders?.length || 0) > 0)
          .length,
      },
    ].filter((x) => x.value > 0);
  }, [type, projects]);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="card analytics-card">
      <div className="section-heading">
        <div>
          <div className="eyebrow">{configs[type].eyebrow}</div>
          <h2>{configs[type].title}</h2>
          <p>Live from your saved project data</p>
        </div>
        <button
          className="chart-remove"
          onClick={onRemove}
          aria-label={`Remove ${configs[type].title}`}
          title="Remove graph"
        >
          <X size={16} />
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="chart-empty">
          Not enough project data yet. Update project statuses or
          create proposals to populate this graph.
        </div>
      ) : (
        <div className="bar-chart">
          {rows.map((row, i) => (
            <div className="bar-row" key={`${row.label}-${i}`}>
              <span title={row.label}>{row.label}</span>
              <div className="bar-track">
                <i
                  style={{
                    width: `${Math.max(3, (row.value / max) * 100)}%`,
                  }}
                />
              </div>
              <b>
                {row.value}
                {type === "effort" ? "h" : ""}
              </b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function Metric({ icon, label, value, detail }) {
  return (
    <div className="metric card">
      <div className="metric-top">
        <span className="metric-icon">{icon}</span>
        <span className="metric-label">{label}</span>
      </div>
      <strong className="metric-value">{value}</strong>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}
function Step({ n, title, text, done }) {
  return (
    <div className="step">
      <div className={`step-number ${done ? "done" : ""}`}>
        {done ? <CheckCircle2 size={18} /> : n}
      </div>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Detail({ title, items }) {
  return (
    <div className="detail-box">
      <h4>{title}</h4>
      {items?.length ? (
        items.map((x, i) => <p key={i}>• {x}</p>)
      ) : (
        <p className="muted">None generated.</p>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
