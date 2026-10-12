import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const config=JSON.parse(await readFile(new URL("../../runtime/project-final/environment.json",import.meta.url),"utf8"));
const database=new URL(config.DATABASE_URL);
if(database.hostname!=="127.0.0.1" || database.port!=="55432" || database.pathname!=="/aura_project" || config.AUTH_DATABASE_SCHEMA!=="aura_project_identity" || config.CORE_DATABASE_SCHEMA!=="aura_project_core" || config.AURA_LOCAL_PROJECT!=="1" || config.CORE_IDENTITY_REALM!=="project")throw new Error("Dedicated local project required");
const child=spawn(process.execPath,process.argv.slice(2),{cwd:new URL("../",import.meta.url),env:{...process.env,...config},stdio:"inherit"});
child.on("exit",code=>{process.exitCode=code??1;});
