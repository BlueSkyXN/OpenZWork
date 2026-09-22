let bootstrapModulePromise;
export const loadBootstrapModule = () => {
    bootstrapModulePromise ??= import("@zcode/bootstrap");
    return bootstrapModulePromise;
};
