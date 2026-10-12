import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { auth } from "../lib/auth";
import type { ProjectCohort } from "../../core-api/lib/project-cohort";
process.umask(0o077);
if(process.env.AURA_LOCAL_PROJECT!=="1" || process.env.AURA_IDENTITY_MODE!=="project" || process.env.AUTH_DATABASE_SCHEMA!=="aura_project_identity" || new URL(process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL??"").hostname!=="127.0.0.1")throw new Error("Private project identities required");
const folder=new URL("../../../../runtime/project-final/",import.meta.url),cohort=JSON.parse(await readFile(new URL("cohort.json",folder),"utf8")) as ProjectCohort;
type Account=ProjectCohort["accounts"][number]&{password:string};let accounts:Account[];
try{accounts=JSON.parse(await readFile(new URL("accounts.json",folder),"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;accounts=cohort.accounts.map(account=>({...account,password:randomBytes(20).toString("base64url")+"aA1!"}));await writeFile(new URL("accounts.json",folder),JSON.stringify(accounts,null,2)+"\n",{mode:0o600,flag:"wx"});}
if(accounts.length!==cohort.accounts.length || cohort.accounts.some(account=>!accounts.some(a=>a.id===account.id && a.email===account.email)))throw new Error("Private credential manifest differs from cohort");
const pool=new Pool({connectionString:process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL,max:5});
try{
  const existing=new Map((await pool.query<{id:string;email:string}>('SELECT id,email FROM "aura_project_identity"."user"')).rows.map(r=>[r.email,r.id]));
  for(let i=0;i<accounts.length;i+=4)await Promise.all(accounts.slice(i,i+4).map(async account=>{
    let subject=existing.get(account.email);
    if(!subject){const result=await auth.api.signUpEmail({body:{email:account.email,name:account.name,password:account.password}});subject=result.user.id;}
    const linked=await pool.query('UPDATE "aura_project_core".people SET external_subject=$1 WHERE id=$2 AND email=$3',[subject,account.id,account.email]);
    if(linked.rowCount!==1)throw new Error("Project identity binding failed");
  }));console.log(JSON.stringify({projectAccountsProvisioned:accounts.length,credentialsPrinted:false,realInstitutionVerificationClaimed:false}));
}finally{await pool.end();}
