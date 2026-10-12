import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCollegeAttendanceReview } from "../lib/chapter11/college-attendance-review";
import { createCollegeAttendanceServer } from "../lib/chapter11/college-attendance-server";

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2];
if (!input) throw new Error("Pass attendance.json from the local import. See docs/COLLEGE_ATTENDANCE_IMPORT.md.");
const port = Number(process.argv[3] ?? 3501);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a local port between 1024 and 65535");
const review = await loadCollegeAttendanceReview(resolve(here, "../../../../runtime/college-attendance"), input);
const assets = resolve(here, "../local/college-attendance");
const [html, script, css] = await Promise.all(["index.html", "review.js", "review.css"].map(name => readFile(resolve(assets, name), "utf8")));
const server = createCollegeAttendanceServer(review, { html: html!, script: script!, css: css! });
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE" ? "Port is already in use. Choose another port after attendance.json." : "Could not start the local review.");
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`College attendance review: http://127.0.0.1:${port}`);
  console.log(`${review.students.length} students from ${review.sources.length} reports. Read-only, on this computer. Press Ctrl+C to stop.`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.close(); });
