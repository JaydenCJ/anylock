// Shared test helpers: fixture loading and a parse shortcut against dist/.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fixture(name) {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

export function fixturePath(name) {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export const DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));
export const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
