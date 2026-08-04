import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { buildClassScaffold } from "../src/services/scaffold.js";
import { ScaffoldClassInputSchema } from "../src/tools/scaffold_class.js";

describe("class scaffold generation", () => {
  it("builds one exported class with loud placeholders and a body-free outline", () => {
    const project = new Project({ useInMemoryFileSystem: true });

    const scaffold = buildClassScaffold(project, "/src/user.service.ts", {
      className: "UserService",
      imports: [
        { from: "@nestjs/common", named: ["Injectable"] },
        { from: "./repository.js", named: ["UserRepository"] },
      ],
      extends: "BaseService",
      implements: ["UserReader"],
      decorators: ["@Injectable()"],
      constructorParams: [
        {
          name: "repository",
          type: "UserRepository",
          accessModifier: "private readonly",
        },
      ],
      properties: [
        {
          name: "cacheKey",
          type: "string",
          accessModifier: "private",
          initializer: '"users"',
        },
      ],
      methods: [
        {
          name: "findUser",
          isAsync: true,
          accessModifier: "public",
          params: [{ name: "id", type: "string" }],
          returnType: "Promise<string>",
          decorators: ["@Trace()"],
          docs: ["Finds a user by id."],
        },
      ],
    });

    const sourceFile = scaffold.sourceFile;
    const classDeclaration = sourceFile.getClassOrThrow("UserService");
    const method = classDeclaration.getMethodOrThrow("findUser");

    expect(sourceFile.getImportDeclarations()).toHaveLength(2);
    expect(classDeclaration.isExported()).toBe(true);
    expect(classDeclaration.getExtendsOrThrow().getText()).toBe("BaseService");
    expect(classDeclaration.getImplements().map((item) => item.getText())).toEqual(["UserReader"]);
    expect(classDeclaration.getDecoratorOrThrow("Injectable").getText()).toBe("@Injectable()");
    expect(classDeclaration.getConstructors()[0]?.getParameters()[0]?.getText()).toBe(
      "private readonly repository: UserRepository",
    );
    expect(method.getBodyText()).toContain(
      'throw new Error("Not implemented: UserService.findUser");',
    );
    expect(scaffold.pendingMethods).toEqual(["UserService.findUser"]);
    expect(scaffold.outline).toContain("public async findUser(id: string): Promise<string>;");
    expect(scaffold.outline).not.toContain("not implemented");
  });

  it("rejects ambiguous or injectable declaration names", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const base = {
      className: "SafeService",
      imports: [],
      implements: [],
      decorators: [],
      constructorParams: [],
      properties: [],
    };

    expect(() =>
      buildClassScaffold(project, "/src/duplicate.ts", {
        ...base,
        methods: [
          { name: "run", isAsync: false, params: [], returnType: "void" },
          { name: "run", isAsync: false, params: [], returnType: "void" },
        ],
      }),
    ).toThrow(/unique/i);

    expect(() =>
      buildClassScaffold(project, "/src/injected.ts", {
        ...base,
        className: "Safe {} export class Injected",
        methods: [{ name: "run", isAsync: false, params: [], returnType: "void" }],
      }),
    ).toThrow(/identifier/i);
  });

  it("rejects fragments that escape their declaration position", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const base = {
      className: "SafeService",
      imports: [],
      implements: [],
      decorators: [],
      constructorParams: [],
      properties: [],
    };

    expect(() =>
      buildClassScaffold(project, "/src/type-injection.ts", {
        ...base,
        methods: [
          {
            name: "run",
            isAsync: false,
            params: [],
            returnType: "string; export class Injected {}",
          },
        ],
      }),
    ).toThrow(/valid TypeScript|exactly one TypeScript type/i);

    expect(() =>
      buildClassScaffold(project, "/src/initializer-injection.ts", {
        ...base,
        properties: [{ name: "value", type: "number", initializer: "1; injected = true" }],
        methods: [{ name: "run", isAsync: false, params: [], returnType: "void" }],
      }),
    ).toThrow(/exactly one TypeScript expression/i);

    expect(() =>
      buildClassScaffold(project, "/src/decorator-injection.ts", {
        ...base,
        decorators: ["@Trace()); class Injected {} //"],
        methods: [{ name: "run", isAsync: false, params: [], returnType: "void" }],
      }),
    ).toThrow(/valid TypeScript|decorator/i);
  });

  it("rejects duplicate parameters, ambiguous members and uninitialized properties", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const base = {
      className: "SafeService",
      imports: [],
      implements: [],
      decorators: [],
      constructorParams: [],
      properties: [],
    };

    expect(() =>
      buildClassScaffold(project, "/src/duplicate-params.ts", {
        ...base,
        methods: [
          {
            name: "run",
            isAsync: false,
            params: [
              { name: "value", type: "string" },
              { name: "value", type: "number" },
            ],
            returnType: "void",
          },
        ],
      }),
    ).toThrow(/parameter names must be unique/i);

    expect(() =>
      buildClassScaffold(project, "/src/member-collision.ts", {
        ...base,
        properties: [{ name: "run", type: "string", initializer: '"safe"' }],
        methods: [{ name: "run", isAsync: false, params: [], returnType: "void" }],
      }),
    ).toThrow(/collide/i);

    expect(() =>
      buildClassScaffold(project, "/src/uninitialized.ts", {
        ...base,
        properties: [{ name: "value", type: "string" }],
        methods: [{ name: "run", isAsync: false, params: [], returnType: "void" }],
      }),
    ).toThrow(/requires an initializer/i);
  });

  it("rejects unknown public input keys", () => {
    expect(
      ScaffoldClassInputSchema.safeParse({
        project_root: "/project",
        file_path: "src/service.ts",
        class_name: "Service",
        methods: [{ name: "run", return_type: "void" }],
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
