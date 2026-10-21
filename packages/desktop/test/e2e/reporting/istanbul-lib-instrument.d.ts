declare module "istanbul-lib-instrument" {
  import type { FileCoverageData } from "istanbul-lib-coverage";
  export function createInstrumenter(options?: {
    coverageVariable?: string;
    parserPlugins?: string[];
    produceSourceMap?: boolean;
  }): {
    instrumentSync(code: string, filename: string): string;
    lastFileCoverage(): FileCoverageData | undefined;
  };
}
