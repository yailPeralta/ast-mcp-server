export interface GnuMvProbeResult {
  readonly status: "pass";
  readonly version: "9.7";
}

export interface GnuMvPreparationResult extends GnuMvProbeResult {
  readonly source: "runner" | "pinned-gnu-source";
}

export const GNU_MV_SOURCE: Readonly<{
  version: "9.7";
  url: "https://mirrors.kernel.org/gnu/coreutils/coreutils-9.7.tar.xz";
  sha256: "e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf";
  maximumBytes: number;
}>;

export function probeGnuMv(binary?: string, temporaryRoot?: string): Promise<GnuMvProbeResult>;
export function prepareGnuMv(): Promise<GnuMvPreparationResult>;
