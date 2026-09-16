export type ConstructionScheduleTask = {
  id: string | number;
  name: string;
  start: string;
  days: number;
  progress: number;
  dependency?: string;
  trade?: string;
  qualityCategoryId?: string;
};

export type ScheduleTaskAnalysis = {
  id: string;
  plannedStart: string;
  plannedFinish: string;
  calculatedStart: string;
  calculatedFinish: string;
  forecastFinish: string;
  totalFloatDays: number;
  critical: boolean;
  late: boolean;
  status: "Complete" | "In Progress" | "Not Started";
  predecessorIds: string[];
};

export type ScheduleAnalysis = {
  generatedAt: string;
  projectFinish: string;
  forecastFinish: string;
  criticalPath: string[];
  lateTaskIds: string[];
  lookahead14: string[];
  lookahead21: string[];
  lookahead42: string[];
  warnings: string[];
  tasks: ScheduleTaskAnalysis[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function analyzeConstructionSchedule(
  input: ConstructionScheduleTask[],
  today = new Date().toISOString().slice(0, 10),
): ScheduleAnalysis {
  const warnings: string[] = [];
  const tasks = input.map((task) => ({
    ...task,
    id: String(task.id),
    start: DATE.test(task.start) ? task.start : today,
    days: Math.max(1, Math.round(Number(task.days) || 1)),
    progress: Math.max(0, Math.min(100, Number(task.progress) || 0)),
  }));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const byName = new Map(tasks.map((task) => [task.name.trim().toLowerCase(), task]));
  const predecessors = new Map<string, string[]>();
  for (const task of tasks) {
    const resolved = dependencyTokens(task.dependency).flatMap((token) => {
      const match = byId.get(token) || byName.get(token.toLowerCase());
      if (!match) {
        warnings.push(`${task.name}: predecessor “${token}” was not found.`);
        return [];
      }
      if (match.id === task.id) {
        warnings.push(`${task.name}: a task cannot depend on itself.`);
        return [];
      }
      return [match.id];
    });
    predecessors.set(task.id, Array.from(new Set(resolved)));
  }

  const order = topologicalOrder(tasks.map((task) => task.id), predecessors);
  if (order.cycleIds.length) {
    warnings.push(`Dependency cycle detected: ${order.cycleIds.join(", ")}. Planned dates were preserved for those activities.`);
  }
  const calculated = new Map<string, { start: string; finish: string }>();
  for (const id of order.ids) {
    const task = byId.get(id)!;
    const predecessorFinish = (predecessors.get(id) || [])
      .map((predecessorId) => calculated.get(predecessorId)?.finish || byId.get(predecessorId)?.start || task.start)
      .sort()
      .at(-1);
    const earliestAfterPredecessor = predecessorFinish ? addDays(predecessorFinish, 1) : task.start;
    const start = earliestAfterPredecessor > task.start ? earliestAfterPredecessor : task.start;
    calculated.set(id, { start, finish: addDays(start, task.days - 1) });
  }
  for (const id of order.cycleIds) {
    const task = byId.get(id)!;
    calculated.set(id, { start: task.start, finish: addDays(task.start, task.days - 1) });
  }

  const projectFinish = Array.from(calculated.values()).map((item) => item.finish).sort().at(-1) || today;
  const successors = new Map(tasks.map((task) => [task.id, [] as string[]]));
  for (const [id, ids] of predecessors) {
    ids.forEach((predecessorId) => successors.get(predecessorId)?.push(id));
  }
  const lateFinish = new Map<string, string>();
  for (const id of [...order.ids].reverse()) {
    const nextStarts = (successors.get(id) || []).map((successorId) => {
      const successor = byId.get(successorId)!;
      const successorFinish = lateFinish.get(successorId) || projectFinish;
      return addDays(successorFinish, -(successor.days - 1));
    });
    lateFinish.set(id, nextStarts.length ? addDays(nextStarts.sort()[0], -1) : projectFinish);
  }

  const analyzed = tasks.map((task): ScheduleTaskAnalysis => {
    const dates = calculated.get(task.id)!;
    const latestFinish = lateFinish.get(task.id) || projectFinish;
    const float = Math.max(0, differenceInDays(dates.finish, latestFinish));
    const remainingDays = Math.max(0, Math.ceil(task.days * (1 - task.progress / 100)));
    const forecastStart = task.progress > 0 && task.progress < 100 && today > dates.start ? today : dates.start;
    const forecastFinish = task.progress >= 100 ? dates.finish : addDays(forecastStart, Math.max(0, remainingDays - 1));
    return {
      id: task.id,
      plannedStart: task.start,
      plannedFinish: addDays(task.start, task.days - 1),
      calculatedStart: dates.start,
      calculatedFinish: dates.finish,
      forecastFinish,
      totalFloatDays: float,
      critical: float === 0,
      late: task.progress < 100 && forecastFinish > dates.finish,
      status: task.progress >= 100 ? "Complete" : task.progress > 0 ? "In Progress" : "Not Started",
      predecessorIds: predecessors.get(task.id) || [],
    };
  });
  const forecastFinish = analyzed.map((task) => task.forecastFinish).sort().at(-1) || projectFinish;
  const lookahead = (days: number) => analyzed
    .filter((task) => task.status !== "Complete" && task.calculatedStart >= today && task.calculatedStart <= addDays(today, days))
    .map((task) => task.id);
  return {
    generatedAt: new Date().toISOString(),
    projectFinish,
    forecastFinish,
    criticalPath: analyzed.filter((task) => task.critical).map((task) => task.id),
    lateTaskIds: analyzed.filter((task) => task.late).map((task) => task.id),
    lookahead14: lookahead(14),
    lookahead21: lookahead(21),
    lookahead42: lookahead(42),
    warnings: Array.from(new Set(warnings)),
    tasks: analyzed,
  };
}

function dependencyTokens(value?: string) {
  const normalized = String(value || "").trim();
  if (!normalized || /^none$/i.test(normalized)) return [];
  return normalized.split(/[,;|]+/).map((item) => item.trim()).filter(Boolean);
}

function topologicalOrder(ids: string[], predecessors: Map<string, string[]>) {
  const incoming = new Map(ids.map((id) => [id, predecessors.get(id)?.length || 0]));
  const successors = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [id, dependencies] of predecessors) dependencies.forEach((dependency) => successors.get(dependency)?.push(id));
  const queue = ids.filter((id) => incoming.get(id) === 0);
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const successor of successors.get(id) || []) {
      const next = (incoming.get(successor) || 0) - 1;
      incoming.set(successor, next);
      if (next === 0) queue.push(successor);
    }
  }
  return { ids: ordered, cycleIds: ids.filter((id) => !ordered.includes(id)) };
}

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function differenceInDays(left: string, right: string) {
  return Math.round((new Date(`${right}T12:00:00Z`).getTime() - new Date(`${left}T12:00:00Z`).getTime()) / 86400000);
}
