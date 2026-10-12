import EmbeddedPostgres from "embedded-postgres";
import { mkdir, readFile, writeFile, access, open } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);
const platform=resolve(dirname(fileURLToPath(import.meta.url)),".."),folder=resolve(platform,"../runtime/project-final");
await mkdir(folder,{recursive:true,mode:0o700});
const environmentFile=resolve(folder,"environment.json");let config;
try{config=JSON.parse(await readFile(environmentFile,"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;
  const password=randomBytes(24).toString("base64url"),database=`postgresql://aura:${password}@127.0.0.1:55432/aura_project`;
  config={AURA_LOCAL_PROJECT:"1",AURA_IDENTITY_MODE:"project",AURA_PORTAL_MODE:"project",CORE_IDENTITY_REALM:"project",DATABASE_URL:database,DATABASE_URL_UNPOOLED:database,CORE_DATABASE_SCHEMA:"aura_project_core",AUTH_DATABASE_SCHEMA:"aura_project_identity",AURA_CLIENT_PROFILE:"local",BETTER_AUTH_SECRET:randomBytes(32).toString("base64url"),PORTAL_SESSION_SECRET:randomBytes(32).toString("base64url"),LOCAL_BETTER_AUTH_URL:"http://127.0.0.1:3200",BETTER_AUTH_URL:"http://127.0.0.1:3200",LOCAL_AURA_IDENTITY_URL:"http://127.0.0.1:3200",LOCAL_CORE_API_URL:"http://127.0.0.1:3300",CORE_API_URL:"http://127.0.0.1:3300",LOCAL_CORE_OIDC_ISSUER:"http://127.0.0.1:3200/api/auth",LOCAL_CORE_OIDC_JWKS_URL:"http://127.0.0.1:3200/api/auth/jwks",AURA_PORTAL_ORIGINS_JSON:"{}",CH11_MODEL:process.env.CH11_MODEL??"",CH11_MODEL_BASE_URL:process.env.CH11_MODEL_BASE_URL??"",CH11_MODEL_API_KEY:process.env.CH11_MODEL_API_KEY??""};
  await writeFile(environmentFile,JSON.stringify(config,null,2)+"\n",{mode:0o600,flag:"wx"});
}
const dbUrl=new URL(config.DATABASE_URL);
if(dbUrl.hostname!=="127.0.0.1" || dbUrl.port!=="55432" || dbUrl.pathname!=="/aura_project" || config.CORE_DATABASE_SCHEMA!=="aura_project_core" || config.AUTH_DATABASE_SCHEMA!=="aura_project_identity")throw new Error("Invalid private project runtime configuration");
for(const name of ["LOCAL_BETTER_AUTH_URL","BETTER_AUTH_URL","LOCAL_AURA_IDENTITY_URL","LOCAL_CORE_API_URL","CORE_API_URL","LOCAL_CORE_OIDC_ISSUER","LOCAL_CORE_OIDC_JWKS_URL","CH11_MODEL_BASE_URL"])if(config[name] && !["127.0.0.1","localhost","[::1]"].includes(new URL(config[name]).hostname))throw new Error("Project services and model inference must remain on loopback");
const env={...process.env,...config,NODE_ENV:"development"},children=[],logs=[];
const postgres=new EmbeddedPostgres({databaseDir:resolve(folder,"postgres"),user:dbUrl.username,password:dbUrl.password,port:55432,persistent:true,authMethod:"scram-sha-256",postgresFlags:["-c","listen_addresses=127.0.0.1","-c",`unix_socket_directories=${folder}`]});
let stopped=false;
async function stop(){if(stopped)return;stopped=true;for(const child of children)child.kill("SIGTERM");await Promise.all(children.map(child=>new Promise(done=>{if(child.exitCode!==null)return done();child.once("exit",done);setTimeout(()=>{child.kill("SIGKILL");done();},3000).unref();})));await postgres.stop();await Promise.all(logs.map(log=>log.close()));}
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>void stop().then(()=>process.exit(0)));
function command(args){return new Promise((done,fail)=>{const child=spawn(process.execPath,args,{cwd:platform,env,stdio:"inherit"});child.on("error",fail);child.on("exit",code=>code===0?done():fail(new Error(`Project setup command failed (${code})`)));});}
try{
  try{await access(resolve(folder,"postgres/PG_VERSION"));}catch{await postgres.initialise();}
  await postgres.start();const client=postgres.getPgClient("postgres","127.0.0.1");await client.connect();
  try{if(!(await client.query("SELECT 1 FROM pg_database WHERE datname='aura_project'")).rowCount)await client.query('CREATE DATABASE "aura_project"');}finally{await client.end();}
  if(process.argv.includes("--database-only")){console.log("Private PostgreSQL ready on 127.0.0.1:55432");await new Promise(()=>{});}
  await command(["--import","tsx","services/core-api/scripts/migrate.ts"]);
  const schemaClient=postgres.getPgClient("aura_project","127.0.0.1");await schemaClient.connect();try{await schemaClient.query('CREATE SCHEMA IF NOT EXISTS "aura_project_identity"');}finally{await schemaClient.end();}
  await command(["node_modules/auth/dist/index.mjs","migrate","--config","services/auth-server/lib/auth.ts","--yes"]);
  await command(["--import","tsx","services/core-api/scripts/prepare-project-cohort.ts"]);
  await command(["--import","tsx","services/auth-server/scripts/provision-portal-clients.ts"]);
  await command(["--import","tsx","services/auth-server/scripts/seed-project-identities.ts"]);
  if(process.argv.includes("--setup")){await stop();console.log("Private project initialized; run npm run project:start");process.exit(0);}
  const apps=[...Array.from({length:6},(_,i)=>[`${["student","parent","faculty","hod","governance","lms"][i]}-portal`,3101+i,"apps"]),["auth-server",3200,"services"],["core-api",3300,"services"]];
  for(const [name,port,group] of apps){const log=await open(resolve(folder,`${name}.log`),"a",0o600);logs.push(log);const child=spawn(process.execPath,[resolve(platform,"node_modules/next/dist/bin/next"),"start","-H","127.0.0.1","-p",String(port)],{cwd:resolve(platform,`${group}/${name}`),env:{...env,NODE_ENV:"production",LOCAL_PORTAL_ORIGIN:`http://127.0.0.1:${port}`},stdio:["ignore",log.fd,log.fd]});children.push(child);child.on("exit",code=>{if(!stopped){console.error(`${name} exited (${code}); inspect private runtime log.`);void stop().then(()=>process.exit(1));}});}
  console.log("AURA project running: Student 3101 · Parent 3102 · Faculty 3103 · HoD 3104 · AI Operations 3105 · LMS 3106");
  console.log("Account credentials: runtime/project-final/accounts.json (private). All student records remain on this computer.");
  await new Promise(()=>{});
}catch(error){console.error(error.message);await stop();process.exit(1);}
