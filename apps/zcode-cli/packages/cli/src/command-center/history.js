export async function recordSlashCommandInHistory(deps, input, command) {
    if (!deps.recordInputHistory)
        return;
    try {
        await deps.recordInputHistory(input, "slash_command");
    }
    catch {
        // Input history is recall UX; command execution must not depend on it.
    }
}
