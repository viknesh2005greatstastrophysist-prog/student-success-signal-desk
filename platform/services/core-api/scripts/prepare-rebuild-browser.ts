import type { ActorContext } from '@aura/contracts';
import { withCoreTransaction,closePool } from '../lib/db';
import { getCurrentGeneration } from '../lib/command-ledger';
import { seedChapterSources } from '../lib/chapter11/service';
if(!/^aura_core_test_/.test(process.env.CORE_DATABASE_SCHEMA??''))throw new Error('Browser setup requires an isolated test schema');
try{const actor=await withCoreTransaction(async c=>{const gen=await getCurrentGeneration(c);const p=(await c.query<{id:string}>("SELECT id FROM people WHERE generation_id=$1 AND email='governance@aura.invalid'",[gen])).rows[0]!;return {role:'governance',personId:p.id,subject:'aura-demo-governance'} as ActorContext;});await seedChapterSources(actor);console.log('Labelled synthetic career records are linked. LMS evidence continues to come from real LMS activity.');}finally{await closePool();}
