import { digest, packetSchema, validatePacket, type Composer, type Packet, type GenerationContext } from "./engine";

/** Cache only an allowed action ordering/timing. Every case keeps its own facts and citations. */
export function projectProfileComposer(provider: Composer) {
  const profiles=new Map<string,Promise<Packet>>();const stats={actualModelCalls:0,reusedProfiles:0,profiles:0};
  const composer:Composer={modelId:`${provider.modelId}; shared action profiles`,async generate(context:GenerationContext){
    const key=digest({domain:context.domain,policy:context.risk.policyVersion,signals:context.risk.signals,codes:context.baseline.actions.map(a=>a.code)});
    let profile=profiles.get(key);
    if(!profile){stats.profiles++;profile=(async()=>{stats.actualModelCalls++;const result=await provider.generate(context);
      if(!validatePacket(result,context.evidence,context.risk,context.domain).valid)throw new Error("Shared action profile failed validation; use explicit case fallback");
      return packetSchema.parse(result);})();profiles.set(key,profile);
    }else stats.reusedProfiles++;
    const result=await profile;
    return {...context.baseline,actions:result.actions.map(action=>{
      const own=context.baseline.actions.find(a=>a.code===action.code);if(!own)throw new Error("Profile action is not applicable to this case");return {...own,dueInDays:action.dueInDays};
    })};
  }};
  return {composer,stats};
}
