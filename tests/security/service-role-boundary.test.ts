import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, normalize, relative, resolve } from "node:path"

import { describe, expect, it } from "vitest"

const dashboardRoot = join(process.cwd(), "apps/dashboard")

describe("service-role client boundary", () => {
  it("keeps the service-role client in a server-only module", () => {
    const adminModule = readFileSync(
      join(dashboardRoot, "src/lib/supabase/admin.ts"),
      "utf8",
    )

    expect(adminModule).toContain('import "server-only"')
    expect(adminModule).toContain("SUPABASE_SERVICE_ROLE_KEY")
  })

  it("does not expose the service-role secret through client modules", () => {
    const clientModules = [
      "src/env/client.ts",
      "src/lib/supabase/browser.ts",
      "src/app/login/login-form.tsx",
    ].map((filePath) => readFileSync(join(dashboardRoot, filePath), "utf8"))

    expect(clientModules.join("\n")).not.toContain("SUPABASE_SERVICE_ROLE_KEY")
  })

  it("does not allow NEXT_PUBLIC service-role environment names", () => {
    const source = readWorkspaceSource()

    expect(source).not.toMatch(/NEXT_PUBLIC_[A-Z0-9_]*SERVICE[A-Z0-9_]*ROLE/i)
  })

  it("detects a client component dependency graph that reaches the admin client", () => {
    const graph = new Map<string, string[]>([
      ["src/app/example/client.tsx", ["src/lib/reexport.ts"]],
      ["src/lib/reexport.ts", ["src/lib/supabase/admin.ts"]],
      ["src/lib/supabase/admin.ts", []],
    ])
    const clientFiles = new Set(["src/app/example/client.tsx"])

    expect(clientGraphReachesAdmin(graph, clientFiles)).toBe(true)
  })

  it("keeps committed client components away from the admin client", () => {
    const files = readSourceFileEntries(dashboardRoot)
    const graph = buildImportGraph(files)
    const clientFiles = new Set(
      files
        .filter((file) => file.source.includes('"use client"'))
        .map((file) => file.relativePath),
    )

    expect(clientGraphReachesAdmin(graph, clientFiles)).toBe(false)
  })
})

function clientGraphReachesAdmin(
  graph: Map<string, string[]>,
  clientFiles: Set<string>,
) {
  const visited = new Set<string>()
  const stack = [...clientFiles]

  while (stack.length > 0) {
    const current = stack.pop()

    if (!current || visited.has(current)) {
      continue
    }

    if (current.endsWith("src/lib/supabase/admin.ts")) {
      return true
    }

    visited.add(current)
    stack.push(...(graph.get(current) ?? []))
  }

  return false
}

function readSourceFileEntries(directory: string) {
  return readSourceFiles(directory).map((absolutePath) => ({
    absolutePath,
    relativePath: normalize(relative(dashboardRoot, absolutePath)),
    source: readFileSync(absolutePath, "utf8"),
  }))
}

function readSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry)

    if (
      absolutePath.includes("/.next/") ||
      absolutePath.includes("/node_modules/")
    ) {
      return []
    }

    if (statSync(absolutePath).isDirectory()) {
      return readSourceFiles(absolutePath)
    }

    if (!/\.(ts|tsx)$/.test(absolutePath)) {
      return []
    }

    return [absolutePath]
  })
}

function readWorkspaceSource() {
  return readSourceFileEntries(dashboardRoot)
    .map((file) => file.source)
    .join("\n")
}

function buildImportGraph(
  files: { absolutePath: string; relativePath: string; source: string }[],
) {
  const existingFiles = new Set(files.map((file) => file.relativePath))

  return new Map(
    files.map((file) => [
      file.relativePath,
      parseImports(file.source)
        .map((importPath) => resolveImport(file.absolutePath, importPath))
        .filter((importPath): importPath is string => Boolean(importPath))
        .filter((importPath) => existingFiles.has(importPath)),
    ]),
  )
}

function parseImports(source: string) {
  return [
    ...source.matchAll(/import(?:\s+[^"']+\s+from\s+|\s*)["']([^"']+)["']/g),
  ].map((match) => match[1])
}

function resolveImport(fromFile: string, importPath: string) {
  if (importPath.startsWith("@/")) {
    return resolveCandidate(join(dashboardRoot, "src", importPath.slice(2)))
  }

  if (importPath.startsWith(".")) {
    return resolveCandidate(resolve(dirname(fromFile), importPath))
  }

  return null
}

function resolveCandidate(candidate: string) {
  for (const extension of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const absolutePath = `${candidate}${extension}`

    if (statExists(absolutePath)) {
      return normalize(relative(dashboardRoot, absolutePath))
    }
  }

  return null
}

function statExists(absolutePath: string) {
  try {
    return statSync(absolutePath).isFile()
  } catch {
    return false
  }
}
