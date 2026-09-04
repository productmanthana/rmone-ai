export interface ResourcePopupProjectCandidate {
  projectId: string;
  projectName?: string;
}

export interface ResourcePopupProjectRef {
  pid: string;
  pct: number;
}

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function resolveResourcePopupProjectId(
  compactId: string,
  candidates: ResourcePopupProjectCandidate[],
  projectNameForId: (projectId: string) => string,
): string {
  const compactKey = normalized(compactId);
  if (!compactKey) return compactId;

  const exact = candidates.find(candidate => normalized(candidate.projectId) === compactKey);
  if (exact?.projectId) return exact.projectId;

  const compactLabels = new Set(
    [compactId, projectNameForId(compactId)]
      .map(normalized)
      .filter(Boolean),
  );
  const matchingIds = Array.from(new Set(
    candidates
      .filter(candidate =>
        [candidate.projectName, projectNameForId(candidate.projectId)]
          .map(normalized)
          .some(label => Boolean(label) && compactLabels.has(label))
      )
      .map(candidate => candidate.projectId.trim())
      .filter(Boolean),
  ));

  return matchingIds.length === 1 ? matchingIds[0] : compactId;
}

export function canonicalizeResourcePopupProjectRefs(
  refs: ResourcePopupProjectRef[],
  candidates: ResourcePopupProjectCandidate[],
  projectNameForId: (projectId: string) => string,
): ResourcePopupProjectRef[] {
  const merged = new Map<string, ResourcePopupProjectRef>();
  for (const ref of refs) {
    const pid = resolveResourcePopupProjectId(ref.pid, candidates, projectNameForId);
    const key = normalized(pid);
    if (!key) continue;
    const current = merged.get(key);
    const pct = Number.isFinite(ref.pct) ? ref.pct : 0;
    if (current) current.pct += pct;
    else merged.set(key, { pid, pct });
  }
  return [...merged.values()];
}