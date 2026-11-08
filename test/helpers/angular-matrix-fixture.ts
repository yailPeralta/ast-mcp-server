import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Deterministic Angular project used by the template type-check spike and matrix tests (#421).
 *
 * `components` widgets each get two consuming hosts, so a project of N widgets has 3N standalone
 * components and 3N external templates (100 widgets give 300 components and 300 templates). The
 * modeled rename turns the `label` input of widget 0 into `heading`; the overlay holds the files
 * that rename edits, mirroring what a rename plan would carry.
 */
export interface MatrixProjectOptions {
  /** Number of widget components; each one gets two host components that consume it. */
  components: number;
  /** Mis-rename the binding of one edited consumer host, so it no longer type-checks. */
  seedBrokenConsumer?: boolean;
  /** Add an invalid binding to an edited host, so the error exists before and after the rename. */
  seedPreexistingError?: boolean;
}

export interface MatrixOverlayEntry {
  /** Project-relative POSIX path. */
  path: string;
  text: string;
}

export interface MatrixProject {
  /** Project-relative POSIX path to file text, `tsconfig.json` included. */
  files: Record<string, string>;
  componentCount: number;
  templateCount: number;
  rename: {
    from: string;
    to: string;
    overlay: MatrixOverlayEntry[];
    seeded: { brokenConsumer?: string; preexistingError?: string };
  };
}

const HOSTS_PER_WIDGET = 2;
const RENAME_FROM = "label";
const RENAME_TO = "heading";
const MISSPELLED_RENAME_TO = "headng";

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ES2022",
    moduleResolution: "bundler",
    strict: true,
    experimentalDecorators: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  },
  angularCompilerOptions: { strictTemplates: true },
  include: ["src/**/*.ts"],
};

const widgetTs = (index: number, input: string) =>
  `import { Component, Input } from "@angular/core";

@Component({
  selector: "app-widget-${index}",
  standalone: true,
  templateUrl: "./widget-${index}.component.html",
})
export class Widget${index}Component {
  @Input() ${input} = "";
}
`;

const widgetHtml = (input: string) => `<span>{{ ${input} }}</span>\n`;

const hostTs = (widget: number, host: number) =>
  `import { Component } from "@angular/core";
import { Widget${widget}Component } from "./widget-${widget}.component";

@Component({
  selector: "app-host-${widget}-${host}",
  standalone: true,
  imports: [Widget${widget}Component],
  templateUrl: "./host-${widget}-${host}.component.html",
})
export class Host${widget}x${host}Component {
  title = "title-${widget}-${host}";
  items = ["a", "b", "c"];
}
`;

const hostHtml = (widget: number, input: string, extra: string) =>
  `<section>
  <app-widget-${widget} [${input}]="title"></app-widget-${widget}>${extra}
  @for (item of items; track item) {
    <span>{{ item }}</span>
  }
</section>
`;

const PREEXISTING_ERROR_LINE = (widget: number) =>
  `\n  <app-widget-${widget} [nonexistent]="title"></app-widget-${widget}>`;

export function generateMatrixProject(options: MatrixProjectOptions): MatrixProject {
  const { components } = options;
  if (!Number.isInteger(components) || components < 1) {
    throw new RangeError("components must be a positive integer");
  }
  const files: Record<string, string> = {
    "tsconfig.json": `${JSON.stringify(TSCONFIG, null, 2)}\n`,
  };
  const overlay: MatrixOverlayEntry[] = [];
  const seeded: MatrixProject["rename"]["seeded"] = {};

  for (let widget = 0; widget < components; widget += 1) {
    const widgetBase = `src/widget-${widget}.component`;
    files[`${widgetBase}.ts`] = widgetTs(widget, RENAME_FROM);
    files[`${widgetBase}.html`] = widgetHtml(RENAME_FROM);
    if (widget === 0) {
      overlay.push(
        { path: `${widgetBase}.ts`, text: widgetTs(widget, RENAME_TO) },
        { path: `${widgetBase}.html`, text: widgetHtml(RENAME_TO) },
      );
    }
    for (let host = 0; host < HOSTS_PER_WIDGET; host += 1) {
      const hostBase = `src/host-${widget}-${host}.component`;
      const seedsError = widget === 0 && host === 0 && options.seedPreexistingError === true;
      const extra = seedsError ? PREEXISTING_ERROR_LINE(widget) : "";
      files[`${hostBase}.ts`] = hostTs(widget, host);
      files[`${hostBase}.html`] = hostHtml(widget, RENAME_FROM, extra);
      if (seedsError) seeded.preexistingError = `${hostBase}.html`;
      if (widget !== 0) continue;
      const broken = host === 1 && options.seedBrokenConsumer === true;
      if (broken) seeded.brokenConsumer = `${hostBase}.html`;
      overlay.push({
        path: `${hostBase}.html`,
        text: hostHtml(widget, broken ? MISSPELLED_RENAME_TO : RENAME_TO, extra),
      });
    }
  }

  const componentCount = components * (1 + HOSTS_PER_WIDGET);
  return {
    files,
    componentCount,
    templateCount: componentCount,
    rename: { from: RENAME_FROM, to: RENAME_TO, overlay, seeded },
  };
}

export async function writeMatrixProject(root: string, project: MatrixProject): Promise<void> {
  for (const [relativePath, text] of Object.entries(project.files)) {
    const target = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
}
