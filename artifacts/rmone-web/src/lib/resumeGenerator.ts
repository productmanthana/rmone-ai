import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ResourceProfileBundle } from "@/lib/api";

export interface ResumeExtraSummary {
  role?: string | null;
  jobTitle?: string | null;
  businessUnit?: string | null;
  division?: string | null;
  department?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  lastActiveDate?: string | null;
  billingRate?: string | null;
  currentCapacityPct?: number | null;
  activeAllocations?: { projectId: string; projectName?: string; pct: number; startDate: string; endDate: string }[];
  tenantName?: string | null;
  employeeType?: string | null;
  employeeId?: string | null;
  phoneNumber?: string | null;
  skills?: { skillName: string; proficiency: number | null }[];
  experienceTags?: string[];
}

function safe(v?: string | number | null): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Compiles a résumé PDF entirely from data already known to the system (talent
 * profile fields + org/employment/allocation context passed in via
 * `extra`) — no uploaded file required. Renders each section as a
 * professionally-styled table (via jspdf-autotable) so labels/values and
 * multi-column rows stay perfectly aligned. Used by the "Download Resume"
 * action on the Resources → Staff → Resource Profile modal.
 */
export function generateResumePdf(
  guid: string,
  fallbackName: string | undefined,
  fallbackEmail: string | undefined,
  data: ResourceProfileBundle | undefined,
  extra?: ResumeExtraSummary,
): void {
  const name = safe(data?.name) || safe(fallbackName) || "Resource";
  const email = safe(data?.email) || safe(fallbackEmail);
  const profile = data?.profile;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 48;
  const tableWidth = pageWidth - marginX * 2;
  let y = 54;

  const green: [number, number, number] = [107, 165, 57];
  const dark: [number, number, number] = [30, 41, 51];
  const muted: [number, number, number] = [107, 126, 138];
  const lightRow: [number, number, number] = [247, 249, 247];

  const ensureSpace = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      y = 54;
    }
  };

  const sectionTitle = (title: string) => {
    ensureSpace(30);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...green);
    doc.text(title.toUpperCase(), marginX, y);
    y += 5;
    doc.setDrawColor(...green);
    doc.setLineWidth(1.1);
    doc.line(marginX, y + 2, pageWidth - marginX, y + 2);
    doc.setLineWidth(0.5);
    y += 12;
    doc.setTextColor(...dark);
  };

  /** Draws a circular donut gauge (0-100%+) with a percentage label in the center. */
  const circularGauge = (cx: number, cy: number, r: number, pct: number, color: [number, number, number]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (doc as any).context2d;
    const frac = Math.max(0, Math.min(1, pct / 100));
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#E5E9E5";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2, false);
    ctx.stroke();
    if (frac > 0) {
      ctx.strokeStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
      ctx.stroke();
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(r > 26 ? 13 : 10.5);
    doc.setTextColor(...color);
    doc.text(`${Math.round(pct)}%`, cx, cy + (r > 26 ? 4.5 : 3.5), { align: "center" });
  };

  /** Circular capacity gauge + label/status, used as the headline visual for utilization. */
  const capacityGauge = (pct: number) => {
    const r = 32;
    const blockH = r * 2 + 14;
    ensureSpace(blockH);
    const color: [number, number, number] = pct > 100 ? [232, 119, 34] : pct >= 80 ? green : [90, 150, 210];
    const cx = marginX + r + 2;
    const cy = y + r + 2;
    circularGauge(cx, cy, r, pct, color);
    const textX = cx + r + 22;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...dark);
    doc.text("Current Capacity", textX, cy - 3);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...color);
    doc.text(
      pct > 100 ? "Overloaded - above full capacity" : pct >= 80 ? "Fully utilized" : "Has available capacity",
      textX,
      cy + 13,
    );
    y += blockH;
  };

  /** Draws a compact multi-row horizontal bar chart (e.g. skills, allocations). */
  const barChart = (
    rows: { label: string; value: number; max: number; display?: string; color?: [number, number, number] }[],
  ) => {
    if (rows.length === 0) return;
    const rowH = 16;
    const labelW = tableWidth * 0.32;
    const valueW = 42;
    const barAreaW = tableWidth - labelW - valueW - 10;
    ensureSpace(rows.length * rowH + 10);
    rows.forEach((r) => {
      ensureSpace(rowH);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.7);
      doc.setTextColor(...dark);
      const truncated = doc.splitTextToSize(r.label, labelW - 4)[0] ?? r.label;
      doc.text(truncated, marginX, y + 7.5);
      const barX = marginX + labelW;
      doc.setFillColor(233, 236, 233);
      doc.roundedRect(barX, y + 2, barAreaW, 8, 2, 2, "F");
      const frac = r.max > 0 ? Math.max(0, Math.min(1, r.value / r.max)) : 0;
      const fillW = Math.max(3, frac * barAreaW);
      doc.setFillColor(...(r.color ?? green));
      doc.roundedRect(barX, y + 2, fillW, 8, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.2);
      doc.setTextColor(...muted);
      doc.text(r.display ?? String(r.value), barX + barAreaW + 8, y + 7.5);
      y += rowH;
    });
    y += 10;
  };

  /** Renders a bordered, professional table and advances `y` past it. */
  const table = (
    head: string[][] | undefined,
    body: (string | { content: string; styles?: Record<string, unknown> })[][],
    colWidths?: number[],
  ) => {
    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      tableWidth,
      head,
      body,
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 9.5,
        textColor: dark,
        cellPadding: { top: 5, bottom: 5, left: 7, right: 7 },
        lineColor: [222, 227, 224],
        lineWidth: 0.6,
      },
      headStyles: {
        fillColor: green,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8.5,
      },
      alternateRowStyles: { fillColor: lightRow },
      columnStyles: colWidths
        ? colWidths.reduce((acc, w, i) => ({ ...acc, [i]: { cellWidth: w } }), {} as Record<number, { cellWidth: number }>)
        : undefined,
    });
    // @ts-expect-error autoTable attaches lastAutoTable to the doc instance
    y = doc.lastAutoTable.finalY + 22;
  };

  // Letterhead — tenant/company is the primary brand mark (large), with a
  // small "Powered by RM ONE" tag underneath. Falls back to the RM ONE mark
  // alone when no tenant name is available.
  const brandY = y;
  const tenantName = safe(extra?.tenantName);
  if (tenantName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...dark);
    doc.text(tenantName, pageWidth - marginX, brandY, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const poweredByWidth = doc.getTextWidth("POWERED BY ");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    const rmOneWidth = doc.getTextWidth("RM ONE");
    const tagStartX = pageWidth - marginX - poweredByWidth - rmOneWidth;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...muted);
    doc.text("POWERED BY ", tagStartX, brandY + 13, { align: "left" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...green);
    doc.text("RM ONE", tagStartX + poweredByWidth, brandY + 13, { align: "left" });
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13.5);
    doc.setTextColor(...green);
    const rmWidth = doc.getTextWidth("RM ");
    const oneWidth = doc.getTextWidth("ONE");
    const brandStartX = pageWidth - marginX - (rmWidth + oneWidth);
    doc.text("RM ", brandStartX, brandY, { align: "left" });
    doc.setTextColor(...dark);
    doc.text("ONE", brandStartX + rmWidth, brandY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text("OPERATIONAL INTELLIGENCE", pageWidth - marginX, brandY + 12, { align: "right" });
  }

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.setTextColor(...dark);
  doc.text(name, marginX, y);
  y += 22;

  const headlineOrRole = safe(profile?.headline) || safe(extra?.jobTitle) || safe(extra?.role);
  if (headlineOrRole) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12.5);
    doc.setTextColor(...green);
    doc.text(headlineOrRole, marginX, y);
    y += 18;
  }

  const contactBits = [email, safe(profile?.location), safe(profile?.linkedinUrl)].filter(Boolean);
  if (contactBits.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...muted);
    doc.text(contactBits.join("   |   "), marginX, y);
    y += 18;
  } else {
    y += 6;
  }

  ensureSpace(0);
  doc.setDrawColor(...dark);
  doc.setLineWidth(1.6);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 24;

  // Summary / bio
  if (safe(profile?.bio)) {
    sectionTitle("Summary");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...dark);
    const wrapped = doc.splitTextToSize(safe(profile!.bio), tableWidth);
    ensureSpace(wrapped.length * 13 + 10);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 13 + 14;
  }

  // Organization & role context
  const orgRows: [string, string][] = [
    ["Business Unit", safe(extra?.businessUnit)],
    ["Division", extra?.division && extra.division !== extra.businessUnit ? safe(extra.division) : ""],
    ["Department", safe(extra?.department)],
    ["Role", safe(extra?.role)],
    ["Job Title", safe(extra?.jobTitle)],
    ["Start Date", safe(extra?.startDate)],
    ["End Date", safe(extra?.endDate)],
    ["Billing Rate", safe(extra?.billingRate)],
    ["Employee Type", safe(extra?.employeeType)],
    ["Employee ID", safe(extra?.employeeId)],
    ["Phone", safe(extra?.phoneNumber)],
    ["Years of Experience", safe(profile?.yearsExperience)],
    ["Available From", safe(profile?.availableFrom)],
    ["Preferred Roles", safe(profile?.preferredRoles)],
  ].filter(([, v]) => v) as [string, string][];

  if (orgRows.length) {
    sectionTitle("Current Role");
    table(
      undefined,
      orgRows.map(([label, value]) => [
        { content: label, styles: { fontStyle: "bold", textColor: muted, fillColor: [255, 255, 255] } },
        { content: value, styles: { fillColor: [255, 255, 255] } },
      ]),
      [tableWidth * 0.28, tableWidth * 0.72],
    );
  }

  // Current capacity / active allocations
  const hasAllocations = extra?.activeAllocations && extra.activeAllocations.length > 0;
  if (extra?.currentCapacityPct != null || hasAllocations) {
    // Reserve the whole section (gauge + chart header) as one block so it
    // never gets awkwardly split across a page break mid-section.
    const reserved = 30 + (extra?.currentCapacityPct != null ? 78 : 0) + (hasAllocations ? 26 + Math.min(extra!.activeAllocations!.length, 4) * 16 : 0);
    ensureSpace(reserved);
    sectionTitle("Current Allocations");
    if (extra?.currentCapacityPct != null) {
      capacityGauge(extra.currentCapacityPct);
    }
    if (hasAllocations) {
      barChart(
        extra!.activeAllocations!.map((a) => ({
          label: a.projectName && a.projectName !== a.projectId ? a.projectName : a.projectId,
          value: a.pct,
          max: 100,
          display: `${Number(a.pct.toFixed(2))}%`,
        })),
      );
      table(
        [["Project", "Allocation", "Start", "End"]],
        extra!.activeAllocations!.map((a) => [
          a.projectName && a.projectName !== a.projectId ? `${a.projectName} (${a.projectId})` : a.projectId,
          `${Number(a.pct.toFixed(2))}%`,
          a.startDate,
          a.endDate,
        ]),
        [tableWidth * 0.5, tableWidth * 0.15, tableWidth * 0.175, tableWidth * 0.175],
      );
    } else {
      y += 8;
    }
  }

  // Skills — prefer the full talent-profile bundle; fall back to the lighter
  // extra.skills array that comes from the Postgres user_skills table directly.
  const skillsData = data?.skills && data.skills.length > 0
    ? data.skills
    : (extra?.skills ?? []).map(s => ({ skillName: s.skillName, proficiency: s.proficiency, isPrimary: false }));

  if (skillsData.length > 0) {
    sectionTitle("Skills");
    barChart(
      skillsData.map((s) => ({
        label: s.skillName,
        value: s.proficiency ?? 0,
        max: 5,
        display: s.proficiency ? `${s.proficiency}/5` : "-",
      })),
    );
  }

  // Experience Tags
  if (extra?.experienceTags && extra.experienceTags.length > 0) {
    sectionTitle("Experience Tags");
    const tagText = extra.experienceTags.join("   ·   ");
    const wrapped = doc.splitTextToSize(tagText, tableWidth);
    ensureSpace(wrapped.length * 14 + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...dark);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 14 + 8;
  }

  // Certifications
  if (data?.certifications && data.certifications.length > 0) {
    sectionTitle("Certifications");
    table(
      [["Certification", "Issuer", "Issued", "Expires"]],
      data.certifications.map((c) => [
        safe(c.name),
        safe(c.issuer) || "-",
        safe(c.issueDate) || "-",
        safe(c.expiryDate) || "-",
      ]),
      [tableWidth * 0.4, tableWidth * 0.3, tableWidth * 0.15, tableWidth * 0.15],
    );
  }

  // Education
  if (data?.education && data.education.length > 0) {
    sectionTitle("Education");
    table(
      [["Degree", "Field of Study", "Institution", "Years"]],
      data.education.map((e) => [
        safe(e.degree) || "-",
        safe(e.fieldOfStudy) || "-",
        safe(e.institution) || "-",
        [e.startYear, e.endYear].filter(Boolean).join(" - ") || "-",
      ]),
      [tableWidth * 0.25, tableWidth * 0.3, tableWidth * 0.3, tableWidth * 0.15],
    );
  }

  // Work history
  if (data?.workHistory && data.workHistory.length > 0) {
    sectionTitle("Work History");
    table(
      [["Title", "Company", "Dates", "Description"]],
      data.workHistory.map((w) => [
        safe(w.title) || "-",
        safe(w.company) || "-",
        [w.startDate, w.endDate || (w.isCurrent ? "Present" : "")].filter(Boolean).join(" to ") || "-",
        safe(w.description) || "-",
      ]),
      [tableWidth * 0.18, tableWidth * 0.18, tableWidth * 0.16, tableWidth * 0.48],
    );
  }

  // Portfolio / projects (talent-tracked, distinct from live allocations)
  if (data?.projects && data.projects.length > 0) {
    sectionTitle("Portfolio Projects");
    table(
      [["Project", "Client", "Description"]],
      data.projects.map((p) => [safe(p.name) || "-", safe(p.client) || "-", safe(p.description) || "-"]),
      [tableWidth * 0.25, tableWidth * 0.25, tableWidth * 0.5],
    );
  }

  if (extra?.lastActiveDate) {
    ensureSpace(20);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...muted);
    doc.text(`Last active: ${extra.lastActiveDate}`, marginX, y);
  }

  const fileSafeName = name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "resource";
  doc.save(`${fileSafeName}_resume.pdf`);
}
