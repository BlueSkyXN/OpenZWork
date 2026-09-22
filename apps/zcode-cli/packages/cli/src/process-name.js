export const CLI_COMMAND_NAME = "zcode";
export const CLI_PROCESS_NAME = "zcode-cli";
export const setCliProcessTitle = (target = process) => {
    target.title = CLI_PROCESS_NAME;
};
