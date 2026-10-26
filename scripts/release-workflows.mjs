export const RELEASE_WORKFLOWS = [
  ["core", "CI", "ci.yml"],
  ["extended", "Extended checks (non-blocking)", "extended-checks.yml"],
  ["installers", "Installers", "installers.yml"],
];

export function matchesReleaseWorkflow(run, name, tag) {
  const definition = RELEASE_WORKFLOWS.find(([, expected]) => expected === name);
  if (!definition || run.path !== `.github/workflows/${definition[2]}`) return false;
  // tag 的 run-name 会进入 GitHub API 的 name 字段；固定路径才是工作流身份。
  if (run.name === name) return true;
  const title = `Release ${tag} / ${name}`;
  return Boolean(tag) && run.name === title && run.display_title === title;
}
