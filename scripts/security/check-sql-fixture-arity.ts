/**
 * Static arity check over pgTAP fixture INSERTs.
 *
 * CI run #18 failed with "INSERT has more target columns than expressions": a
 * fixture listed nine columns and supplied eight values. pgTAP reported
 * "45 planned / 0 executed" -- the setup aborted before a single assertion ran,
 * so the failure looked nothing like the mistake that caused it.
 *
 * The whole file is checked, not only the first offending statement: an arity
 * error aborts the transaction at the first one, hiding every later instance.
 * There were four.
 *
 * Deliberately simple. This counts top-level commas in a column list and in each
 * VALUES tuple or SELECT list; it is not an SQL parser, and it does not need to
 * be. The database remains the authority -- this exists so the answer arrives in
 * a second instead of after a full CI cycle.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const TEST_DIR = "supabase/tests"

interface Finding {
  file: string
  line: number
  table: string
  columns: number
  expressions: number
  detail: string
}

/** Splits on commas that are not inside parentheses or a quoted string. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ""

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (char === "'") {
      // '' is an escaped quote inside a string, not a terminator.
      if (quoted && input[index + 1] === "'") {
        current += "''"
        index += 1
        continue
      }
      quoted = !quoted
    }

    if (!quoted) {
      if (char === "(") depth += 1
      if (char === ")") depth -= 1

      if (char === "," && depth === 0) {
        parts.push(current.trim())
        current = ""
        continue
      }
    }

    current += char
  }

  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Reads the parenthesised group starting at `start`, honouring quotes. */
function readGroup(
  source: string,
  start: number,
): { body: string; end: number } | null {
  if (source[start] !== "(") return null

  let depth = 0
  let quoted = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]

    if (char === "'") {
      if (quoted && source[index + 1] === "'") {
        index += 1
        continue
      }
      quoted = !quoted
    }

    if (quoted) continue
    if (char === "(") depth += 1
    if (char === ")") {
      depth -= 1
      if (depth === 0) {
        return { body: source.slice(start + 1, index), end: index }
      }
    }
  }

  return null
}

function checkFile(file: string): Finding[] {
  const source = readFileSync(join(TEST_DIR, file), "utf8")
  const findings: Finding[] = []
  const pattern = /insert\s+into\s+(?:public\.)?(\w+)\s*\(/gi

  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    const table = match[1]
    const columnGroup = readGroup(source, match.index + match[0].length - 1)

    if (!columnGroup) continue

    const columns = splitTopLevel(columnGroup.body).length
    const line = source.slice(0, match.index).split("\n").length

    const rest = source.slice(columnGroup.end + 1)
    const valuesMatch = /^\s*values\s*/i.exec(rest)

    if (valuesMatch) {
      // Every tuple until the statement terminator.
      let cursor = columnGroup.end + 1 + valuesMatch[0].length
      let tupleIndex = 0

      while (source[cursor] === "(") {
        const tuple = readGroup(source, cursor)
        if (!tuple) break

        const expressions = splitTopLevel(tuple.body).length
        if (expressions !== columns) {
          findings.push({
            file,
            line: source.slice(0, cursor).split("\n").length,
            table,
            columns,
            expressions,
            detail: `VALUES tuple ${tupleIndex + 1}`,
          })
        }

        cursor = tuple.end + 1
        tupleIndex += 1
        while (source[cursor] === "," || /\s/.test(source[cursor] ?? ""))
          cursor += 1
      }

      continue
    }

    const selectMatch = /^\s*select\s+([\s\S]*?)\s+from\s/i.exec(rest)

    if (selectMatch) {
      const expressions = splitTopLevel(selectMatch[1]).length
      if (expressions !== columns) {
        findings.push({
          file,
          line,
          table,
          columns,
          expressions,
          detail: "SELECT list",
        })
      }
    }
  }

  return findings
}

function main() {
  let files: string[]

  try {
    files = readdirSync(TEST_DIR).filter((name) => name.endsWith(".sql"))
  } catch {
    console.error(`SCANNER_UNAVAILABLE: cannot read ${TEST_DIR}`)
    process.exit(2)
  }

  if (files.length === 0) {
    console.error(`SCANNER_UNAVAILABLE: no SQL test files in ${TEST_DIR}`)
    process.exit(2)
  }

  const findings = files.flatMap(checkFile)

  console.log(`sql-fixture-arity: ${files.length} dosya tarandi`)

  if (findings.length > 0) {
    console.error(
      "ARITY_MISMATCH: fixture column and expression counts disagree",
    )
    for (const finding of findings) {
      console.error(
        `  ${finding.file}:${finding.line} ${finding.table} ` +
          `${finding.columns} kolon vs ${finding.expressions} ifade (${finding.detail})`,
      )
    }
    process.exit(1)
  }

  console.log("CLEAN: her INSERT'in kolon ve ifade sayisi eslesiyor")
  process.exit(0)
}

main()
