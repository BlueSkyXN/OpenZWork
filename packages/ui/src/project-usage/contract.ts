import type { AppUsageSnapshot } from "@zcode/shared";
export interface ProjectUsageFilterProps {
  projectId: string | null | undefined;
  projects: NonNullable<AppUsageSnapshot["projects"]>;
  onChange(projectId: string | null | undefined): void;
  disabled?: boolean;
}
