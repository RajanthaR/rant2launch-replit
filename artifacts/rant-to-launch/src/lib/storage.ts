export interface RecentProject {
  slug: string;
  name: string;
  preview: string;
  createdAt: string;
}

const STORAGE_KEY = "recentProjectSlugs";
const MAX_PROJECTS = 20;

export function getRecentProjects(): RecentProject[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    console.error("Failed to parse recent projects", e);
    return [];
  }
}

export function removeRecentProject(slug: string) {
  try {
    const existing = getRecentProjects();
    const filtered = existing.filter((p) => p.slug !== slug);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error("Failed to remove recent project", e);
  }
}

export function renameRecentProject(slug: string, name: string) {
  try {
    const existing = getRecentProjects();
    const updated = existing.map((p) => (p.slug === slug ? { ...p, name } : p));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to rename recent project", e);
  }
}

export function saveRecentProject(project: RecentProject) {
  try {
    const existing = getRecentProjects();
    const filtered = existing.filter((p) => p.slug !== project.slug);
    const updated = [project, ...filtered].slice(0, MAX_PROJECTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save recent project", e);
  }
}

const INFLIGHT_JOB_PREFIX = "inflightJob_";

export function saveInflightJob(slug: string, jobId: string): void {
  try {
    localStorage.setItem(`${INFLIGHT_JOB_PREFIX}${slug}`, jobId);
  } catch (e) {
    console.error("Failed to save inflight job", e);
  }
}

export function getInflightJob(slug: string): string | null {
  try {
    return localStorage.getItem(`${INFLIGHT_JOB_PREFIX}${slug}`);
  } catch (e) {
    console.error("Failed to get inflight job", e);
    return null;
  }
}

export function clearInflightJob(slug: string): void {
  try {
    localStorage.removeItem(`${INFLIGHT_JOB_PREFIX}${slug}`);
  } catch (e) {
    console.error("Failed to clear inflight job", e);
  }
}
