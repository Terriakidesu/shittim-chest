import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dir, "..");
const task = Bun.argv[2] === "build" ? "build" : "dev";
const prepare = Bun.spawn(["bun", "scripts/prepare-editor.ts"], {
  cwd: desktopRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if (await prepare.exited !== 0) process.exit(prepare.exitCode ?? 1);

const command = task === "build"
  ? ["hutch", "electrobun", "build", "--env=stable"]
  : ["hutch", "electrobun", "dev", "--watch"];
const app = Bun.spawn(command, {
  cwd: desktopRoot,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await app.exited);
