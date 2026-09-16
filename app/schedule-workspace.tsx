"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkSheet } from "xlsx";
import { parseSpreadsheetFile } from "./secure-spreadsheet-client";
import { SCHEDULE_QUALITY_CATEGORIES, scheduleQualityCategory } from "../lib/quality-control";
import type { ScheduleTemplate } from "../lib/schedule-templates";
import { analyzeConstructionSchedule } from "../lib/construction-schedule";
import { summaryDrilldownProps } from "./summary-drilldown";

type RecordItem = { id: string; type?: string; title: string; owner: string; due: string; status: string; meta: string; recordDate?: string; recordTime?: string; dateLocked?: boolean; dateAudit?: string[]; auditHistory?: string[]; persistent?: boolean; data?: Record<string, unknown> };
type ScheduleProject = { number: string; name: string; site: string; ownerName: string; projectManager: string; superintendent: string; startDate: string; substantialDate: string; finalDate: string; timeZone: string };
type ChangeOrderData = { newSubstantialDate: string; newFinalDate: string; scheduleUpdateStatus?: "Pending PM Adjustment" | "Applied To Schedule"; workflowHistory: string[] };

function changeOrderData(record?: RecordItem): ChangeOrderData { const data = record?.data ?? {}; return { newSubstantialDate: String(data.newSubstantialDate || ""), newFinalDate: String(data.newFinalDate || ""), scheduleUpdateStatus: data.scheduleUpdateStatus as ChangeOrderData["scheduleUpdateStatus"], workflowHistory: Array.isArray(data.workflowHistory) ? data.workflowHistory as string[] : [] }; }
const companyTimeZone = "America/New_York";
function currentDateInput(timeZone = companyTimeZone, now = new Date()) { const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])); return `${value.year}-${value.month}-${value.day}`; }
function numericDateFromInput(value: string) { if (!value) return "Not Set"; const [year, month, day] = value.split("-").map(Number); return `${month}/${day}/${year}`; }
function displayProjectDate(value: string) { if (!value) return "Not Set"; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
async function persistCommandRecord(projectId: string, recordType: string, record: RecordItem) { const response = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, recordType, record }) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "The Record Could Not Be Saved Permanently."); return result; }

type ScheduleTask = {
  id: number;
  name: string;
  trade: string;
  start: string;
  days: number;
  progress: number;
  dependency: string;
  tone: string;
  baselineStart: string;
  baselineDays: number;
  qualityCategoryId?: string;
  actualStartedAt?: string;
};

type ScheduleAiDraft = {
  draftId: string;
  rationale: string;
  assumptions: string[];
  risks: string[];
  notice: string;
  tasks: Array<{
    name: string;
    trade: string;
    start: string;
    days: number;
    dependency: string;
    qualityCategoryId: string;
    drawingReferences: string[];
  }>;
};

export function ScheduleWorkspace({
  project,
  changeOrders,
  subcontractRecords,
  onChangeOrdersChange,
  scheduleRecords,
  onScheduleRecordsChange,
}: {
  project: ScheduleProject;
  changeOrders: RecordItem[];
  subcontractRecords: RecordItem[];
  onChangeOrdersChange: (next: RecordItem[]) => void;
  scheduleRecords: RecordItem[];
  onScheduleRecordsChange: (next: RecordItem[]) => void;
}) {
  const timeZone = project.timeZone;
  const [tasks, setTasks] = useState<ScheduleTask[]>(() =>
    scheduleRecords.length
      ? scheduleRecords.map((record, index) => ({
          id:
            Number(record.data?.scheduleTaskId || record.id.replace(/\D/g, "")) ||
            index + 1,
          name: record.title,
          trade: String(record.data?.trade || record.owner),
          start: String(
            record.data?.start || record.recordDate || project.startDate,
          ),
          days: Number(record.data?.days || 1),
          progress: Number(record.data?.progress || 0),
          dependency: String(record.data?.dependency || "None"),
          tone: String(record.data?.tone || "orange"),
          baselineStart: String(
            record.data?.baselineStart || record.recordDate || project.startDate,
          ),
          baselineDays: Number(
            record.data?.baselineDays || record.data?.days || 1,
          ),
          qualityCategoryId: String(record.data?.qualityCategoryId || ""),
          actualStartedAt: String(record.data?.actualStartedAt || ""),
        }))
      : [],
  );
  const [adding, setAdding] = useState(false);
  const [calendar, setCalendar] = useState("Monday–Friday");
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [template, setTemplate] = useState("mefford-standard-new-build");
  const [templateNotice, setTemplateNotice] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateNameOpen, setTemplateNameOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [aiDraft, setAiDraft] = useState<ScheduleAiDraft | null>(null);
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const [aiDraftBusy, setAiDraftBusy] = useState(false);
  const [aiDraftConfirmed, setAiDraftConfirmed] = useState(false);
  const [showBaseline, setShowBaseline] = useState(true);
  const [taskName, setTaskName] = useState("");
  const [trade, setTrade] = useState("Mefford Crew");
  const [start, setStart] = useState(() => currentDateInput(timeZone));
  const [finish, setFinish] = useState(() =>
    addScheduleDays(currentDateInput(timeZone), 9),
  );
  const [dependency, setDependency] = useState("None");
  const [qualityCategoryId, setQualityCategoryId] = useState("");
  const [scheduleUpdatedAt, setScheduleUpdatedAt] = useState(() =>
    currentDateInput(timeZone),
  );
  const scheduleImportRef = useRef<HTMLInputElement>(null);
  const projectSubcontractors = useMemo(
    () =>
      Array.from(
        new Set([
          "Mefford Crew",
          ...subcontractRecords
            .map((record) =>
              String(record.data?.subcontractor || record.title).trim(),
            )
            .filter(Boolean),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [subcontractRecords],
  );
  const scheduleStart = useMemo(() => {
    const firstActivityDate = tasks
      .flatMap((task) => [task.start, task.baselineStart])
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort()[0];
    const anchor = new Date(`${firstActivityDate || project.startDate || currentDateInput(timeZone)}T12:00:00Z`);
    const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
    anchor.setUTCDate(anchor.getUTCDate() - daysSinceMonday);
    return anchor;
  }, [project.startDate, tasks, timeZone]);
  const scheduleWeeks = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const week = new Date(scheduleStart);
    week.setUTCDate(week.getUTCDate() + index * 7);
    return {
      key: week.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(week),
    };
  }), [scheduleStart]);
  const pendingAdjustments = changeOrders.filter(
    (record) =>
      record.status === "Executed" &&
      changeOrderData(record).scheduleUpdateStatus === "Pending PM Adjustment",
  );
  const overallProgress = tasks.length
    ? Math.round(
        tasks.reduce((total, task) => total + task.progress, 0) / tasks.length,
      )
    : 0;
  const nextTask = [...tasks]
    .filter((task) => task.progress < 100)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const scheduleIntelligence = useMemo(
    () => analyzeConstructionSchedule(tasks.map((task) => ({ ...task, id: String(task.id) })), currentDateInput(timeZone)),
    [tasks, timeZone],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/schedule-templates?projectId=${encodeURIComponent(project.number)}`)
      .then(async (response) => {
        const result = await response.json() as { templates?: ScheduleTemplate[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Schedule Templates Are Unavailable.");
        if (!cancelled) setTemplates(result.templates || []);
      })
      .catch((error) => { if (!cancelled) setTemplateNotice(error instanceof Error ? error.message : "Schedule Templates Are Unavailable."); });
    return () => { cancelled = true; };
  }, [project.number]);

  function positionValues(startValue: string, duration: number) {
    const startDate = new Date(`${startValue}T12:00:00Z`);
    const week = Math.max(
      0,
      Math.min(
        11,
        Math.floor((startDate.getTime() - scheduleStart.getTime()) / 604800000),
      ),
    );
    const span = Math.max(1, Math.min(12 - week, Math.ceil(duration / 7)));
    return { gridColumn: `${week + 2} / span ${span}`, "--task-start": week + 1, "--task-span": span };
  }

  function scheduleRecord(task: ScheduleTask): RecordItem {
    return {
      id: `SCH-${String(task.id).padStart(3, "0")}`,
      title: task.name,
      owner: task.trade,
      due: numericDateFromInput(task.start),
      status: task.progress >= 100 ? "Complete" : "Active",
      meta: `${task.days} Days · ${task.progress}% Complete`,
      recordDate: task.start,
      data: {
        scheduleTaskId: task.id,
        trade: task.trade,
        start: task.start,
        days: task.days,
        progress: task.progress,
        dependency: task.dependency,
        tone: task.tone,
        baselineStart: task.baselineStart,
        baselineDays: task.baselineDays,
        qualityCategoryId: task.qualityCategoryId || "",
        actualStartedAt: task.actualStartedAt || "",
      },
      persistent: true,
    };
  }

  async function addTask() {
    if (!taskName.trim() || !trade || !start || !finish || finish < start || !qualityCategoryId) {
      setScheduleNotice(
        "Scope Subcontractor Quality Category Start Date And A Valid Finish Date Are Required.",
      );
      return;
    }
    const days = scheduleDuration(start, finish);
    const nextId =
      tasks.reduce((largest, task) => Math.max(largest, task.id), 0) + 1;
    const task: ScheduleTask = {
      id: nextId,
      name: taskName.trim(),
      trade,
      start,
      days,
      progress: 0,
      dependency,
      tone: "orange",
      baselineStart: start,
      baselineDays: days,
      qualityCategoryId,
    };
    const record = scheduleRecord(task);
    try {
      await persistCommandRecord(project.number, "Schedule", record);
      setTasks((current) => [...current, task]);
      onScheduleRecordsChange([...scheduleRecords, record]);
      setScheduleUpdatedAt(currentDateInput(timeZone));
    } catch (error) {
      setScheduleNotice(
        error instanceof Error ? error.message : "The Schedule Activity Could Not Be Saved.",
      );
      return;
    }
    setTaskName("");
    setQualityCategoryId("");
    setAdding(false);
  }

  async function downloadScheduleExcel() {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const projectSheet = XLSX.utils.aoa_to_sheet([
      ["MEFFORD CONTRACTING PROJECT SCHEDULE"],
      ["Download · Edit · Re-Upload To Command Center"],
      [],
      ["Project Number", project.number],
      ["Project Name", project.name],
      ["Project Location", project.site],
      ["Project Manager", project.projectManager],
      ["Superintendent", project.superintendent],
      ["Contract Start", project.startDate],
      ["Substantial Completion", project.substantialDate],
      ["Final Completion", project.finalDate],
      ["Date Updated", scheduleUpdatedAt],
    ]);
    projectSheet["!merges"] = [
      XLSX.utils.decode_range("A1:D1"),
      XLSX.utils.decode_range("A2:D2"),
    ];
    projectSheet["!cols"] = [
      { wch: 24 },
      { wch: 34 },
      { wch: 16 },
      { wch: 16 },
    ];
    const rows = tasks.map((task) => ({
      "Activity ID": `SCH-${String(task.id).padStart(3, "0")}`,
      "Scope Of Work": task.name,
      Subcontractor: task.trade,
      "Start Date": task.start,
      "Finish Date": addScheduleDays(task.start, task.days - 1),
      "Percent Complete": task.progress,
      Status:
        task.progress >= 100
          ? "Complete"
          : task.progress > 0
            ? "In Progress"
            : "Not Started",
      Predecessor: task.dependency,
      "Quality Category": scheduleQualityCategory(task.qualityCategoryId || "")?.label || "CATEGORY REQUIRED",
      Notes: "",
    }));
    const scheduleSheet = XLSX.utils.json_to_sheet(
      rows.length
        ? rows
        : [
            {
              "Activity ID": "",
              "Scope Of Work": "",
              Subcontractor: "",
              "Start Date": "",
              "Finish Date": "",
              "Percent Complete": 0,
              Status: "Not Started",
              Predecessor: "None",
              "Quality Category": "",
              Notes: "",
            },
          ],
    );
    scheduleSheet["!cols"] = [
      { wch: 15 },
      { wch: 38 },
      { wch: 28 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 16 },
      { wch: 24 },
      { wch: 26 },
      { wch: 34 },
    ];
    scheduleSheet["!autofilter"] = {
      ref: `A1:J${Math.max(2, rows.length + 1)}`,
    };
    (
      scheduleSheet as WorkSheet & { "!dataValidations"?: unknown[] }
    )["!dataValidations"] = [
      {
        sqref: "C2:C501",
        type: "list",
        formula1: "'Subcontractors'!$A$2:$A$500",
      },
      {
        sqref: "F2:F501",
        type: "whole",
        operator: "between",
        formula1: "0",
        formula2: "100",
      },
      {
        sqref: "G2:G501",
        type: "list",
        formula1: '"Not Started,In Progress,Complete"',
      },
      {
        sqref: "I2:I501",
        type: "list",
        formula1: "'Quality Categories'!$A$2:$A$100",
      },
    ];
    const subcontractorSheet = XLSX.utils.aoa_to_sheet([
      ["Approved Project Subcontractors"],
      ...projectSubcontractors.map((name) => [name]),
    ]);
    subcontractorSheet["!cols"] = [{ wch: 38 }];
    const qualityCategorySheet = XLSX.utils.aoa_to_sheet([
      ["Required Quality Category", "Automatic Pre-Work Checklist"],
      ...SCHEDULE_QUALITY_CATEGORIES.map((category) => [
        category.label,
        category.templateId
          ? `Requested ${category.leadDays} Day${category.leadDays === 1 ? "" : "s"} Before Start`
          : "No Automatic Pre-Work Checklist",
      ]),
    ]);
    qualityCategorySheet["!cols"] = [{ wch: 34 }, { wch: 42 }];
    XLSX.utils.book_append_sheet(
      workbook,
      projectSheet,
      "Project Information",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      scheduleSheet,
      "Schedule Import",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      subcontractorSheet,
      "Subcontractors",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      qualityCategorySheet,
      "Quality Categories",
    );
    XLSX.writeFile(
      workbook,
      `${project.number}_${project.name.replace(/[^a-z0-9]+/gi, "_")}_Schedule.xlsx`,
    );
    setScheduleNotice(
      "Project Schedule Downloaded! Edit The Schedule Import Sheet And Re-Upload It Here.",
    );
  }

  async function importScheduleExcel(file?: File) {
    if (!file) return;
    try {
      const { rows } = await parseSpreadsheetFile(file, "schedule");
      const imported = rows
        .filter((row) => String(row["Scope Of Work"] || "").trim())
        .map((row, index): ScheduleTask => {
          const name = String(row["Scope Of Work"] || "").trim();
          const importedTrade = String(row.Subcontractor || "").trim();
          const startDate = scheduleImportDate(row["Start Date"]);
          const finishDate = scheduleImportDate(row["Finish Date"]);
          const categoryValue = String(row["Quality Category"] || "").trim();
          const category = SCHEDULE_QUALITY_CATEGORIES.find(
            (item) => item.id.toLowerCase() === categoryValue.toLowerCase() || item.label.toLowerCase() === categoryValue.toLowerCase(),
          );
          if (
            !name ||
            !importedTrade ||
            !startDate ||
            !finishDate ||
            finishDate < startDate ||
            !category
          ) {
            throw new Error(
              `Row ${index + 2} Requires Scope Subcontractor Quality Category Start Date And Finish Date.`,
            );
          }
          if (
            !projectSubcontractors.some(
              (item) => item.toLowerCase() === importedTrade.toLowerCase(),
            )
          ) {
            throw new Error(
              `${importedTrade} Is Not An Approved Subcontractor On ${project.name}. Add The Subcontract First Or Select One From The Downloaded List.`,
            );
          }
          const rawId = String(row["Activity ID"] || "").match(/\d+/)?.[0];
          const existingId = Number(rawId || 0);
          const id =
            existingId ||
            tasks.reduce((largest, task) => Math.max(largest, task.id), 0) +
              index +
              1;
          return {
            id,
            name,
            trade:
              projectSubcontractors.find(
                (item) => item.toLowerCase() === importedTrade.toLowerCase(),
              ) || importedTrade,
            start: startDate,
            days: scheduleDuration(startDate, finishDate),
            progress: Math.max(
              0,
              Math.min(100, Number(row["Percent Complete"] || 0)),
            ),
            dependency: String(row.Predecessor || "None").trim() || "None",
            tone: "orange",
            baselineStart:
              tasks.find((task) => task.id === id)?.baselineStart || startDate,
            baselineDays:
              tasks.find((task) => task.id === id)?.baselineDays ||
              scheduleDuration(startDate, finishDate),
            qualityCategoryId: category.id,
          };
        });
      if (!imported.length) {
        throw new Error(
          "No Schedule Activities Were Found On The Schedule Import Sheet.",
        );
      }
      const duplicateIds = imported.filter(
        (task, index) =>
          imported.findIndex((item) => item.id === task.id) !== index,
      );
      if (duplicateIds.length) {
        throw new Error(
          "Duplicate Activity IDs Were Blocked. Each Schedule Row Must Have A Unique ID.",
        );
      }
      const importedRecords = imported.map(scheduleRecord);
      await Promise.all(
        importedRecords.map((record) =>
          persistCommandRecord(project.number, "Schedule", record),
        ),
      );
      setTasks((current) => {
        const importedIds = new Set(imported.map((task) => task.id));
        return [
          ...current.filter((task) => !importedIds.has(task.id)),
          ...imported,
        ].sort((a, b) => a.start.localeCompare(b.start));
      });
      onScheduleRecordsChange([
        ...scheduleRecords.filter(
          (record) =>
            !importedRecords.some((next) => next.id === record.id),
        ),
        ...importedRecords,
      ]);
      setScheduleUpdatedAt(currentDateInput(timeZone));
      setScheduleNotice(
        `${imported.length} Schedule Activities Imported And Matched Without Duplicates!`,
      );
    } catch (error) {
      setScheduleNotice(
        error instanceof Error
          ? error.message
          : "The Schedule Workbook Could Not Be Imported.",
      );
    } finally {
      if (scheduleImportRef.current) scheduleImportRef.current.value = "";
    }
  }

  async function saveTemplate() {
    if (templateName.trim().length < 4) {
      setTemplateNotice("Enter A Company Schedule Template Name Of At Least Four Characters.");
      return;
    }
    setTemplateSaving(true);
    try {
      const response = await fetch("/api/schedule-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-template", projectId: project.number, name: templateName }) });
      const result = await response.json() as { template?: ScheduleTemplate; notice?: string; error?: string };
      if (!response.ok || !result.template) throw new Error(result.error || "The Schedule Template Could Not Be Saved.");
      setTemplates((current) => [...current.filter((item) => item.id !== result.template!.id), result.template!]);
      setTemplate(result.template.id);
      setTemplateName("");
      setTemplateNameOpen(false);
      setTemplateNotice(result.notice || "Permanent Company Schedule Template Published.");
    } catch (error) { setTemplateNotice(error instanceof Error ? error.message : "The Schedule Template Could Not Be Saved."); }
    finally { setTemplateSaving(false); }
  }

  async function applyTemplate() {
    if (tasks.length) {
      setTemplateNotice("Templates Apply Only To An Empty Schedule. Existing Activities Were Preserved.");
      return;
    }
    if (!template) {
      setTemplateNotice("Blank Schedule Selected. Add Activities Manually Or Select A Controlled Template.");
      return;
    }
    setTemplateSaving(true);
    try {
      const response = await fetch("/api/schedule-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare-template", projectId: project.number, templateId: template }) });
      const result = await response.json() as { tasks?: ScheduleTask[]; template?: { id: string; name: string }; notice?: string; error?: string };
      if (!response.ok || !result.tasks?.length) throw new Error(result.error || "The Schedule Template Could Not Be Prepared.");
      const preparedRecords = result.tasks.map(scheduleRecord);
      for (const record of preparedRecords) await persistCommandRecord(project.number, "Schedule", record);
      setTasks(result.tasks);
      onScheduleRecordsChange(preparedRecords);
      setScheduleUpdatedAt(currentDateInput(timeZone));
      setTemplateNotice(`${result.template?.name || "Schedule Template"} Applied Through The Controlled Schedule Workflow. ${result.tasks.length} Activities Saved.`);
    } catch (error) { setTemplateNotice(error instanceof Error ? error.message : "The Schedule Template Could Not Be Applied."); }
    finally { setTemplateSaving(false); }
  }

  async function updateProgress(id: number, progress: number) {
    const currentTask = tasks.find((task) => task.id === id);
    if (!currentTask?.qualityCategoryId) {
      setScheduleNotice("Assign The Required Quality Category Before Updating This Schedule Activity.");
      return;
    }
    const nextTasks = tasks.map((task) =>
      task.id === id ? { ...task, progress, actualStartedAt: progress > 0 ? task.actualStartedAt || new Date().toISOString() : task.actualStartedAt } : task,
    );
    const changed = nextTasks.find((task) => task.id === id);
    if (!changed) return;
    const record = scheduleRecord(changed);
    setTasks(nextTasks);
    onScheduleRecordsChange([
      ...scheduleRecords.filter((item) => item.id !== record.id),
      record,
    ]);
    try {
      await persistCommandRecord(project.number, "Schedule", record);
      setScheduleUpdatedAt(currentDateInput(timeZone));
    } catch (error) {
      setScheduleNotice(
        error instanceof Error ? error.message : "The Progress Update Could Not Be Saved.",
      );
    }
  }

  async function updateQualityCategory(id: number, categoryId: string) {
    const changed = tasks.find((task) => task.id === id);
    if (!changed || !categoryId) return;
    const nextTask = { ...changed, qualityCategoryId: categoryId };
    const record = scheduleRecord(nextTask);
    try {
      await persistCommandRecord(project.number, "Schedule", record);
      setTasks((current) => current.map((task) => task.id === id ? nextTask : task));
      onScheduleRecordsChange([
        ...scheduleRecords.filter((item) => item.id !== record.id),
        record,
      ]);
      const category = scheduleQualityCategory(categoryId);
      setScheduleNotice(category?.templateId
        ? `${category.label} Assigned. A Superintendent Pre-Work To-Do Is Linked To ${record.id}.`
        : `${category?.label || "Quality Category"} Assigned. No Pre-Work Checklist Is Triggered.`);
    } catch (error) {
      setScheduleNotice(error instanceof Error ? error.message : "The Quality Category Could Not Be Saved.");
    }
  }

  async function applyScheduleAdjustment(record: RecordItem) {
    const data = changeOrderData(record);
    const adjustedTasks = tasks.map((task) =>
      task.name === "Punch list & turnover"
        ? {
            ...task,
            start: data.newSubstantialDate || task.start,
            days: Math.max(
              1,
              Math.round(
                (new Date(`${data.newFinalDate}T12:00:00`).getTime() -
                  new Date(`${data.newSubstantialDate}T12:00:00`).getTime()) /
                  86400000,
              ),
            ),
          }
        : task,
    );
    const nextRecord: RecordItem = {
      ...record,
      data: {
        ...data,
        scheduleUpdateStatus: "Applied To Schedule",
        workflowHistory: [
          ...data.workflowHistory,
          `Schedule Milestone Adjustment Applied By ${project.projectManager} · ${numericDateFromInput(currentDateInput(project.timeZone))}`,
        ],
      },
    };
    try {
      await persistCommandRecord(project.number, "Change Orders", nextRecord);
      const adjustedRecords = adjustedTasks.filter((task, index) => task !== tasks[index]).map(scheduleRecord);
      for (const adjustedRecord of adjustedRecords) await persistCommandRecord(project.number, "Schedule", adjustedRecord);
      setTasks(adjustedTasks);
      if (adjustedRecords.length) onScheduleRecordsChange([
        ...scheduleRecords.filter((item) => !adjustedRecords.some((adjusted) => adjusted.id === item.id)),
        ...adjustedRecords,
      ]);
      onChangeOrdersChange(
        changeOrders.map((item) => (item.id === nextRecord.id ? nextRecord : item)),
      );
      setScheduleUpdatedAt(currentDateInput(timeZone));
      setScheduleNotice(`${record.id} Milestone Dates Applied To The Project Schedule.`);
    } catch (error) {
      setScheduleNotice(error instanceof Error ? error.message : "The Schedule Adjustment Could Not Be Saved.");
    }
  }

  async function requestAiScheduleDraft() {
    setAiDraftBusy(true);
    setScheduleNotice("Reviewing Indexed Project Drawings And Building A Schedule Draft…");
    try {
      const response = await fetch("/api/schedule-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft-from-drawings", projectId: project.number }),
      });
      const result = await response.json() as ScheduleAiDraft & { error?: string };
      if (!response.ok || !result.tasks?.length) throw new Error(result.error || "The Drawing-Based Schedule Draft Could Not Be Created.");
      setAiDraft(result);
      setAiDraftConfirmed(false);
      setAiDraftOpen(true);
      setScheduleNotice(result.notice || "AI Schedule Draft Ready For Project Manager Review.");
    } catch (error) {
      setScheduleNotice(error instanceof Error ? error.message : "The Drawing-Based Schedule Draft Could Not Be Created.");
    } finally {
      setAiDraftBusy(false);
    }
  }

  async function applyAiScheduleDraft() {
    if (!aiDraft || !aiDraftConfirmed) return;
    setAiDraftBusy(true);
    try {
      const existingNames = new Set(tasks.map((task) => task.name.trim().toLowerCase()));
      const firstId = tasks.reduce((largest, task) => Math.max(largest, task.id), 0) + 1;
      const draftedTasks: ScheduleTask[] = aiDraft.tasks
        .filter((task) => !existingNames.has(task.name.trim().toLowerCase()))
        .map((task, index) => ({
          id: firstId + index,
          name: task.name,
          trade: projectSubcontractors.find((name) => name.toLowerCase() === task.trade.toLowerCase()) || "Mefford Crew",
          start: task.start,
          days: task.days,
          progress: 0,
          dependency: task.dependency,
          tone: "orange",
          baselineStart: task.start,
          baselineDays: task.days,
          qualityCategoryId: scheduleQualityCategory(task.qualityCategoryId)?.id || "general-administrative",
        }));
      if (!draftedTasks.length) throw new Error("Every Drafted Activity Already Exists In This Schedule.");
      const draftedRecords = draftedTasks.map(scheduleRecord).map((record, index) => ({
        ...record,
        data: { ...record.data, aiDraftId: aiDraft.draftId, drawingReferences: aiDraft.tasks[index]?.drawingReferences || [], aiSuggested: true, reviewedAndAppliedByProjectManager: true },
        initialAudit: `AI schedule draft ${aiDraft.draftId} reviewed and applied through the controlled schedule workflow.`,
      }));
      for (const record of draftedRecords) await persistCommandRecord(project.number, "Schedule", record);
      setTasks((current) => [...current, ...draftedTasks].sort((left, right) => left.start.localeCompare(right.start)));
      onScheduleRecordsChange([...scheduleRecords, ...draftedRecords]);
      setScheduleUpdatedAt(currentDateInput(timeZone));
      setAiDraftOpen(false);
      setAiDraft(null);
      setAiDraftConfirmed(false);
      setScheduleNotice(`${draftedTasks.length} AI-Suggested Activities Were Reviewed And Applied. Each Activity Is Now In The Normal Schedule And Pre-Work Workflow.`);
    } catch (error) {
      setScheduleNotice(error instanceof Error ? error.message : "The Reviewed Schedule Draft Could Not Be Applied.");
    } finally {
      setAiDraftBusy(false);
    }
  }

  return (
    <div className="module-workspace schedule-workspace">
      <section className="workspace-heading">
        <div>
          <p className="eyebrow orange-text">{project.name}</p>
          <h1>Project Schedule</h1>

        </div>
        <div className="schedule-heading-actions">
          <button className="secondary-action" disabled={!project.number} onClick={downloadScheduleExcel}>
            ↓ Download Excel
          </button>
          <button
            className="secondary-action"
            disabled={!project.number}
            onClick={() => scheduleImportRef.current?.click()}
          >
            ↑ Re-Upload Excel
          </button>
          <button className="secondary-action" disabled={!project.number} onClick={() => window.print()}>
            Print Schedule
          </button>
          <button className="secondary-action schedule-ai-button" disabled={aiDraftBusy || !project.number} onClick={() => void requestAiScheduleDraft()}>
            {aiDraftBusy ? "Reviewing Drawings…" : "✦ Draft From Drawings"}
          </button>
          <button
            className="primary-action large"
            disabled={!project.number}
            onClick={() => {
              const current = currentDateInput(timeZone);
              setStart(current);
              setFinish(addScheduleDays(current, 9));
              setAdding(true);
            }}
          >
            ＋ Add Activity
          </button>
          <input
            ref={scheduleImportRef}
            hidden
            type="file"
                          data-format-required="true"
                          accept=".xlsx,.xls"
            onChange={(event) =>
              void importScheduleExcel(event.target.files?.[0])
            }
          />
        </div>
      </section>
      <section className="schedule-controls">
        <label>
          Project Calendar
          <select
            value={calendar}
            onChange={(event) => setCalendar(event.target.value)}
          >
            <option>Monday–Friday</option>
            <option>Monday–Saturday</option>
            <option>Seven-day calendar</option>
            <option>Custom project calendar</option>
          </select>
        </label>
        <label>
          Start From Template
          <select
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          >
            {templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.tasks.length} Activities</option>)}
            <option value="">Blank Schedule</option>
          </select>
        </label>
        <button className="secondary-action" disabled={templateSaving || Boolean(tasks.length) || !template} onClick={() => void applyTemplate()}>{templateSaving ? "Working..." : "Apply To Empty Schedule"}</button>
        <button className="secondary-action" disabled={!tasks.length || templateSaving} onClick={() => setTemplateNameOpen(true)}>Save Schedule As Template</button>
      </section>
      {templateNotice ? (
        <div className="inline-success">{templateNotice}</div>
      ) : null}
      {scheduleNotice ? <div className="inline-success">{scheduleNotice}</div> : null}
      <section className="schedule-summary">
        <article {...summaryDrilldownProps({ title: "Contract Completion", rows: [{ id: project.number, title: project.name, subtitle: `${project.number} · Contract completion`, status: scheduleIntelligence.forecastFinish > project.finalDate ? "Forecast At Risk" : "On Plan", value: displayProjectDate(project.finalDate), meta: tasks.length ? `Current forecast ${displayProjectDate(scheduleIntelligence.forecastFinish)}` : "No schedule activities recorded" }] })}>
          <span>Contract Completion</span>
          <strong>{displayProjectDate(project.finalDate)}</strong>
        </article>
        <article {...summaryDrilldownProps({ title: "Schedule Activities And Progress", rows: tasks.map((task) => scheduleTaskRow(task, scheduleIntelligence)) })}>
          <span>Overall Progress</span>
          <strong>{overallProgress}%</strong>
        </article>
        <article {...summaryDrilldownProps({ title: "Next Schedule Milestone", rows: nextTask ? [scheduleTaskRow(nextTask, scheduleIntelligence)] : [], emptyText: "No incomplete schedule activity is recorded." })}>
          <span>Next Milestone</span>
          <strong>{nextTask ? `${nextTask.name} · ${displayProjectDate(nextTask.start)}` : "No Activities Yet"}</strong>
        </article>
        <article {...summaryDrilldownProps({ title: "Schedule Health", rows: tasks.filter((task) => scheduleIntelligence.lateTaskIds.includes(String(task.id))).map((task) => scheduleTaskRow(task, scheduleIntelligence)), emptyText: tasks.length ? "No schedule activities are currently late." : "Add or import schedule activities to calculate health." }, "schedule-health")}>
          <span>Schedule Health</span>
          <strong>
              <i /> {!tasks.length ? "Ready To Build" : scheduleIntelligence.lateTaskIds.length ? `${scheduleIntelligence.lateTaskIds.length} Late` : "On Plan"}
          </strong>
        </article>
      </section>
      <section className="schedule-intelligence-strip">
        <article {...summaryDrilldownProps({ title: "Critical Path Activities", rows: tasks.filter((task) => scheduleIntelligence.criticalPath.includes(String(task.id))).map((task) => scheduleTaskRow(task, scheduleIntelligence)) })}><span>CRITICAL PATH</span><strong>{scheduleIntelligence.criticalPath.length}</strong><small>Zero-float activities</small></article>
        <article {...summaryDrilldownProps({ title: "14-Day Lookahead", rows: tasks.filter((task) => scheduleIntelligence.lookahead14.includes(String(task.id))).map((task) => scheduleTaskRow(task, scheduleIntelligence)) })}><span>14-DAY LOOKAHEAD</span><strong>{scheduleIntelligence.lookahead14.length}</strong><small>Upcoming activities</small></article>
        <article {...summaryDrilldownProps({ title: "42-Day Lookahead", rows: tasks.filter((task) => scheduleIntelligence.lookahead42.includes(String(task.id))).map((task) => scheduleTaskRow(task, scheduleIntelligence)) })}><span>42-DAY LOOKAHEAD</span><strong>{scheduleIntelligence.lookahead42.length}</strong><small>Procurement + field horizon</small></article>
        <article {...summaryDrilldownProps({ title: "Forecast Finish Contribution", rows: tasks.map((task) => scheduleTaskRow(task, scheduleIntelligence)) })}><span>FORECAST FINISH</span><strong>{tasks.length ? displayProjectDate(scheduleIntelligence.forecastFinish) : "Not Set"}</strong><small>{!tasks.length ? "Add or import activities" : scheduleIntelligence.forecastFinish > project.finalDate ? "Recovery plan needed" : "At or before contract date"}</small></article>
      </section>
      {pendingAdjustments.length ? <section className="schedule-adjustment-queue"><div><h2>Pending Change Order Schedule Adjustments</h2></div>{pendingAdjustments.map((record) => { const data = changeOrderData(record); return <article key={record.id}><span>{record.id}</span><div><strong>{record.title}</strong><small>Substantial {displayProjectDate(data.newSubstantialDate)} · Final {displayProjectDate(data.newFinalDate)}</small></div><button className="primary-action" onClick={() => applyScheduleAdjustment(record)}>Apply Milestones To Schedule</button></article>; })}</section> : null}
      <section className="gantt-card">
        <div className="gantt-toolbar">
          <div>
            <strong>{project.name} Master Schedule</strong>
            <span>{tasks.length} Activities · Current Project Only</span>
          </div>
          <div>
            <button className="active">Weeks</button>
            <button
              className={showBaseline ? "baseline-active" : ""}
              onClick={() => setShowBaseline((current) => !current)}
            >
              Baseline {showBaseline ? "on" : "off"}
            </button>
            <button onClick={downloadScheduleExcel}>Export Excel</button>
          </div>
        </div>
        <div className="gantt-scroll">
          <div className="gantt-grid gantt-header">
            <div>Activity / trade</div>
            {scheduleWeeks.map((week) => (
              <div key={week.key}>{week.label}</div>
            ))}
          </div>
          {tasks.map((task) => (
            <div className="gantt-grid gantt-row" key={task.id}>
              <div className="task-label">
                <strong>{task.name}</strong>
                <span>
                  {task.trade} · {displayProjectDate(task.start)} · {task.days} days · {scheduleQualityCategory(task.qualityCategoryId || "")?.label || "QUALITY CATEGORY REQUIRED"}
                </span>
                {!task.qualityCategoryId ? <select aria-label={`Quality category for ${task.name}`} value="" onChange={(event) => void updateQualityCategory(task.id, event.target.value)}><option value="">Assign Quality Category</option>{SCHEDULE_QUALITY_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select> : null}
                <label>
                  Progress{" "}
                  <input
                    aria-label={`Progress for ${task.name}`}
                    type="number"
                    min="0"
                    max="100"
                    value={task.progress}
                    onChange={(event) =>
                      void updateProgress(
                        task.id,
                        Math.max(0, Math.min(100, Number(event.target.value))),
                      )
                    }
                  />
                  %
                </label>
              </div>
              {showBaseline ? (
                <div
                  className="baseline-bar"
                  style={positionValues(task.baselineStart, task.baselineDays)}
                  title="Original baseline"
                />
              ) : null}
              <div
                className={`gantt-bar ${task.tone}`}
                style={positionValues(task.start, task.days)}
                title={`${task.name}: ${task.progress}% complete`}
              >
                <span style={{ width: `${task.progress}%` }} />
                <b>{task.progress}%</b>
              </div>
            </div>
          ))}
          <div className="today-line">
            <span>TODAY</span>
          </div>
        </div>
        <div className="gantt-legend">
          <span>
            <i className="complete-dot" /> Work complete
          </span>
          <span>
            <i className="remaining-dot" /> Work remaining
          </span>
          <span>
            <i className="today-dot" /> Today
          </span>
        </div>
      </section>

      {templateNameOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setTemplateNameOpen(false)}><section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-template-name-title"><div className="modal-heading"><div><h2 id="schedule-template-name-title">Publish Current Schedule As Template</h2></div><button aria-label="Close Schedule Template Form" onClick={() => setTemplateNameOpen(false)}>×</button></div><label className="field-label">Template Name<input autoFocus value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Example: Small Municipal Renovation" /></label><div className="modal-actions"><button className="secondary-action" onClick={() => setTemplateNameOpen(false)}>Cancel</button><button className="primary-action large" disabled={templateSaving || templateName.trim().length < 4} onClick={() => void saveTemplate()}>{templateSaving ? "Publishing Template..." : "Publish Company Template"}</button></div></section></div> : null}
      {aiDraftOpen && aiDraft ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAiDraftOpen(false)}><section className="record-modal wide schedule-ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-schedule-draft-title"><div className="modal-heading"><div><h2 id="ai-schedule-draft-title">Review Proposed Project Schedule</h2><span>{aiDraft.notice}</span></div><button aria-label="Close AI Schedule Draft" onClick={() => setAiDraftOpen(false)}>×</button></div><section className="schedule-ai-explanation"><div><strong>Why This Draft</strong><p>{aiDraft.rationale}</p></div><div><strong>Assumptions To Verify</strong><p>{aiDraft.assumptions.length ? aiDraft.assumptions.join(" · ") : "No assumptions returned."}</p></div><div><strong>Risks To Resolve</strong><p>{aiDraft.risks.length ? aiDraft.risks.join(" · ") : "No specific risks returned."}</p></div></section><div className="schedule-ai-table" data-reflow-table=""><div className="schedule-ai-row header" data-reflow-head="medium"><span>Activity</span><span>Trade</span><span>Start / Days</span><span>Predecessor</span><span>Drawing Basis</span></div>{aiDraft.tasks.map((task, index) => <div className="schedule-ai-row" key={`${task.name}-${index}`} data-reflow-row="medium"><span data-label="Activity"><b>{task.name}</b><small>{scheduleQualityCategory(task.qualityCategoryId)?.label || "General / Administrative"}</small></span><span data-label="Trade">{task.trade}</span><span data-label="Start / Days">{displayProjectDate(task.start)} · {task.days}d</span><span data-label="Predecessor">{task.dependency}</span><span data-label="Drawing Basis">{task.drawingReferences.length ? task.drawingReferences.join(", ") : "ASSUMPTION — VERIFY"}</span></div>)}</div><label className="schedule-ai-confirm"><input type="checkbox" checked={aiDraftConfirmed} onChange={(event) => setAiDraftConfirmed(event.target.checked)} /><span>I reviewed every activity, date, duration, responsible trade, predecessor, quality category, and drawing reference. Apply this draft without overwriting existing activities.</span></label><div className="modal-actions"><button className="secondary-action" onClick={() => setAiDraftOpen(false)}>Keep As Unapplied Draft</button><button className="primary-action large" disabled={!aiDraftConfirmed || aiDraftBusy} onClick={() => void applyAiScheduleDraft()}>{aiDraftBusy ? "Applying Through Schedule Controls…" : `Apply ${aiDraft.tasks.length} Reviewed Activities`}</button></div></section></div> : null}
      {adding ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setAdding(false)
          }
        >
          <section
            className="record-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow orange-text">{project.name} SCHEDULE</p>
                <h2 id="activity-title">Add Schedule Activity</h2>
              </div>
              <button aria-label="Close form" onClick={() => setAdding(false)}>
                ×
              </button>
            </div>
            <label className="field-label">
              Activity Name
              <input
                autoFocus
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
                placeholder="Example: Install kennel gates"
              />
            </label>
            <div className="field-grid">
              <label className="field-label">
                Responsible Subcontractor
                <select
                  value={trade}
                  onChange={(event) => setTrade(event.target.value)}
                >
                  {projectSubcontractors.map((subcontractor) => (
                    <option key={subcontractor}>{subcontractor}</option>
                  ))}
                </select>
                <small>Populated From This Project&apos;s Subcontracts</small>
              </label>
              <label className="field-label">
                Start Date
                <input
                  type="date"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
            </div>
            <label className="field-label">
              Required Quality Category
              <select value={qualityCategoryId} onChange={(event) => setQualityCategoryId(event.target.value)}>
                <option value="">Select Category</option>
                {SCHEDULE_QUALITY_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
              <small>Creates The Superintendent&apos;s Automatic Pre-Work To-Do</small>
            </label>
            <div className="field-grid">
              <label className="field-label">
                Finish Date
                <input
                  type="date"
                  min={start}
                  value={finish}
                  onChange={(event) => setFinish(event.target.value)}
                />
              </label>
              <label className="field-label">
                Predecessor
                <select
                  value={dependency}
                  onChange={(event) => setDependency(event.target.value)}
                >
                  <option>None</option>
                  {tasks.map((task) => (
                    <option key={task.id}>{task.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-action"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="primary-action large" onClick={addTask}>
                Add To Schedule
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <section className="schedule-print-sheet" aria-hidden="true">
        <header>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mefford-logo.png" alt="Mefford Contracting" />
          <div>

            <h1>{project.name} Project Schedule</h1>
            <span>
              Project #{project.number} · {project.site}
            </span>
          </div>
          <aside>
            <strong>Date Updated</strong>
            <span>{dateLabelForPrint(scheduleUpdatedAt)}</span>
          </aside>
        </header>
        <div className="schedule-print-project">
          <span><b>Owner</b>{project.ownerName}</span>
          <span><b>Project Manager</b>{project.projectManager}</span>
          <span><b>Superintendent</b>{project.superintendent}</span>
          <span><b>Contract Start</b>{dateLabelForPrint(project.startDate)}</span>
          <span><b>Substantial Completion</b>{dateLabelForPrint(project.substantialDate)}</span>
          <span><b>Final Completion</b>{dateLabelForPrint(project.finalDate)}</span>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Scope Of Work</th><th>Quality Category</th><th>Subcontractor</th><th>Start</th><th>Finish</th><th>Days</th><th>Complete</th><th>Predecessor</th></tr></thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>SCH-{String(task.id).padStart(3, "0")}</td>
                <td>{task.name}</td>
                <td>{scheduleQualityCategory(task.qualityCategoryId || "")?.label || "Required"}</td>
                <td>{task.trade}</td>
                <td>{dateLabelForPrint(task.start)}</td>
                <td>{dateLabelForPrint(addScheduleDays(task.start, task.days - 1))}</td>
                <td>{task.days}</td>
                <td>{task.progress}%</td>
                <td>{task.dependency}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer>
          <span>Command Center Project Schedule</span>
          <span>Printed {dateLabelForPrint(currentDateInput(timeZone))}</span>
        </footer>
      </section>
    </div>
  );
}

function scheduleTaskRow(task: ScheduleTask, intelligence: ReturnType<typeof analyzeConstructionSchedule>) {
  const analysis = intelligence.tasks.find((item) => item.id === String(task.id));
  return { id: String(task.id), title: task.name, subtitle: `${task.trade} · ${displayProjectDate(task.start)} · ${task.days} day${task.days === 1 ? "" : "s"}`, status: analysis?.late ? "Late" : analysis?.status || (task.progress >= 100 ? "Complete" : task.progress ? "In Progress" : "Not Started"), value: `${task.progress}%`, meta: analysis ? `Forecast finish ${displayProjectDate(analysis.forecastFinish)} · ${analysis.totalFloatDays} float days` : task.dependency };
}

function addScheduleDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function scheduleDuration(start: string, finish: string) {
  return Math.max(
    1,
    Math.round(
      (new Date(`${finish}T12:00:00Z`).getTime() -
        new Date(`${start}T12:00:00Z`).getTime()) /
        86_400_000,
    ) + 1,
  );
}

function scheduleImportDate(
  value: unknown,
) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const decoded = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
    return Number.isNaN(decoded.getTime()) ? "" : decoded.toISOString().slice(0, 10);
  }
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function dateLabelForPrint(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(year, month - 1, day))
    : value;
}
