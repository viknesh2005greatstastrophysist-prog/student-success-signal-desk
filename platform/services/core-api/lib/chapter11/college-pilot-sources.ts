import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { CollegeAttendanceReview } from "./college-attendance-review";

export async function verifyPrivateOriginals(privateRoot: string, folder: string, review: CollegeAttendanceReview) {
  const root = await realpath(privateRoot), originals = await realpath(resolve(folder, "originals"));
  const location = relative(root, originals);
  if (location.startsWith("..") || isAbsolute(location)) throw new Error("ORIGINALS_OUT_OF_SCOPE");
  const filenames = await readdir(originals);
  for (const source of review.sources) {
    const matches = filenames.filter(name => name.startsWith(source.id.slice(0, 16) + "-"));
    if (matches.length !== 1) throw new Error("ORIGINAL_FILE_MISSING_OR_AMBIGUOUS");
    const file = await realpath(resolve(originals, matches[0]!)), position = relative(originals, file);
    if (position.startsWith("..") || isAbsolute(position)) throw new Error("ORIGINAL_FILE_OUT_OF_SCOPE");
    if (createHash("sha256").update(await readFile(file)).digest("hex") !== source.id) throw new Error("ORIGINAL_FILE_HASH_MISMATCH");
  }
  return { verified: true, sources: review.sources.length };
}
