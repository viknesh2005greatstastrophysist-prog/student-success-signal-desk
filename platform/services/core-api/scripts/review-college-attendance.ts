import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewCollegeAttendance } from "../lib/chapter11/college-attendance";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const allowed = await realpath(resolve(root, "runtime/college-attendance"));
const input = process.argv[2];
if (!input) throw new Error("Pass the local attendance.json file from the college import");
const path = await realpath(input);
const location = relative(allowed, path);
if (location.startsWith("..") || isAbsolute(location)) throw new Error("Read college attendance only from the private local import directory");
const review = reviewCollegeAttendance(JSON.parse(await readFile(path, "utf8")));
const output = resolve(dirname(path), "project-source-review.json");
await writeFile(output, JSON.stringify(review, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ datasetId: review.datasetId, status: review.status, ...review.summary,
  fullAgentReviewReady: review.fullAgentReviewReady, overallRiskScore: review.overallRiskScore,
  databaseWritten: false, output: "project-source-review.json" }, null, 2));
