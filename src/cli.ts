#!/usr/bin/env node
/**
 * anylock CLI.
 *
 *   anylock parse <file…>     lockfiles → normalized NDJSON on stdout (default)
 *   anylock detect <file…>    print the detected format per file
 *   anylock stats <file…>     per-file package counts
 *   anylock formats           list the supported formats
 *
 * Exit codes: 0 success, 1 at least one file failed to parse/detect,
 * 2 usage error. Warnings go to stderr so stdout stays pure NDJSON.
 */

import { readFileSync } from "node:fs";
import { detectFormat, FORMATS, listFormats, parseLockfile, ParseError, recordToJson } from "./index.js";
import { VERSION } from "./version.js";
import type { FormatId, PackageRecord } from "./types.js";

const USAGE = `anylock ${VERSION} — twelve lockfile formats, one normalized NDJSON schema

Usage:
  anylock [parse] <file…> [options]   parse lockfiles to NDJSON on stdout
  anylock detect <file…>              print the detected format per file
  anylock stats <file…>               per-file package counts
  anylock formats                     list supported formats
  anylock --help | --version

Options:
  --as <format>           skip detection and force a format (see \`anylock formats\`)
  --format <ndjson|json>  output records as NDJSON (default) or one JSON array
  -q, --quiet             suppress parser warnings on stderr

Reading stdin: pass \`-\` as the file. Detection then relies on content
alone; use --as when the content is ambiguous.

Exit codes: 0 success, 1 parse/detect failure, 2 usage error.`;

interface Cli {
  command: "parse" | "detect" | "stats" | "formats";
  files: string[];
  as: FormatId | null;
  format: "ndjson" | "json";
  quiet: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Cli | "help" | "version" {
  const cli: Cli = { command: "parse", files: [], as: null, format: "ndjson", quiet: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--help":
      case "-h":
        return "help";
      case "--version":
      case "-V":
        return "version";
      case "--quiet":
      case "-q":
        cli.quiet = true;
        break;
      case "--as": {
        const v = argv[++i];
        if (v === undefined) throw new UsageError("--as needs a format id");
        if (!listFormats().includes(v as FormatId)) {
          throw new UsageError(`unknown format \`${v}\` — run \`anylock formats\``);
        }
        cli.as = v as FormatId;
        break;
      }
      case "--format": {
        const v = argv[++i];
        if (v !== "ndjson" && v !== "json") {
          throw new UsageError("--format must be `ndjson` or `json`");
        }
        cli.format = v;
        break;
      }
      default:
        if (arg.startsWith("-") && arg !== "-") {
          throw new UsageError(`unknown option \`${arg}\``);
        }
        positional.push(arg);
    }
  }
  const first = positional[0];
  if (first === "parse" || first === "detect" || first === "stats" || first === "formats") {
    cli.command = first;
    cli.files = positional.slice(1);
  } else {
    cli.files = positional;
  }
  if (cli.command !== "formats" && cli.files.length === 0) {
    throw new UsageError("no input files (pass one or more lockfiles, or `-` for stdin)");
  }
  return cli;
}

function readInput(file: string): { content: string; filename: string } {
  if (file === "-") {
    return { content: readFileSync(0, "utf8"), filename: "" };
  }
  return { content: readFileSync(file, "utf8"), filename: file };
}

function runFormats(): void {
  process.stdout.write("format            ecosystem  lockfile\n");
  for (const f of FORMATS) {
    process.stdout.write(
      `${f.id.padEnd(17)} ${f.ecosystem.padEnd(10)} ${f.label}\n`
    );
  }
}

function main(argv: string[]): number {
  let cli: Cli | "help" | "version";
  try {
    cli = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`anylock: ${e.message}\n`);
      process.stderr.write("Run `anylock --help` for usage.\n");
      return 2;
    }
    throw e;
  }
  if (cli === "help") {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (cli === "version") {
    process.stdout.write(VERSION + "\n");
    return 0;
  }
  if (cli.command === "formats") {
    runFormats();
    return 0;
  }

  let failed = false;
  const allRecords: PackageRecord[] = [];

  for (const file of cli.files) {
    let input: { content: string; filename: string };
    try {
      input = readInput(file);
    } catch (e) {
      process.stderr.write(`anylock: cannot read ${file}: ${(e as Error).message}\n`);
      failed = true;
      continue;
    }

    if (cli.command === "detect") {
      const format = cli.as ?? detectFormat(input.content, input.filename);
      if (format === null) {
        process.stdout.write(`${file}\tunknown\n`);
        failed = true;
      } else {
        process.stdout.write(`${file}\t${format}\n`);
      }
      continue;
    }

    try {
      const result = parseLockfile(input.content, {
        filename: input.filename,
        ...(cli.as !== null ? { format: cli.as } : {}),
      });
      if (!cli.quiet) {
        for (const w of result.warnings) {
          const at = w.line === null ? "" : `:${w.line}`;
          process.stderr.write(`anylock: warning: ${file}${at}: ${w.message}\n`);
        }
      }
      if (cli.command === "stats") {
        const n = result.packages.length;
        process.stdout.write(
          `${file}\t${result.format}\t${result.ecosystem}\t${n} ${n === 1 ? "package" : "packages"}\n`
        );
      } else {
        allRecords.push(...result.packages);
      }
    } catch (e) {
      if (e instanceof ParseError) {
        process.stderr.write(`anylock: ${file}: ${e.message}\n`);
        failed = true;
        continue;
      }
      throw e;
    }
  }

  if (cli.command === "parse") {
    if (cli.format === "json") {
      const body = allRecords.map((r) => "  " + recordToJson(r)).join(",\n");
      process.stdout.write(allRecords.length === 0 ? "[]\n" : `[\n${body}\n]\n`);
    } else {
      for (const r of allRecords) {
        process.stdout.write(recordToJson(r) + "\n");
      }
    }
  }
  return failed ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
