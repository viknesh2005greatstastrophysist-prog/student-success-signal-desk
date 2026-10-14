import { digest, isPacketV2, packetSchema, validatePacket, type Composer, type Packet, type GenerationContext } from "./engine";

/**
 * RETIRED for mentor review (Brief 11). Cross-student profile reuse caches one
 * model ordering of catalogue actions and replays it for other students with
 * the same signal pattern. Every case going to mentor review now gets its own
 * grounded packet-v2 draft, so this composer only runs behind an explicit,
 * labelled bulk dry run and refuses any packet-v2 (mentor-review) context.
 */
export function projectProfileComposer(provider: Composer, options: { bulkDryRun: true }) {
  if (options?.bulkDryRun !== true)
    throw new Error("Cross-student profile reuse is retired; pass { bulkDryRun: true } for a labelled dry run");
  const profiles=new Map<string,Promise<Packet>>();const stats={actualModelCalls:0,reusedProfiles:0,profiles:0};
  const composer:Composer={modelId:`${provider.modelId}; shared action profiles (bulk dry run, not for mentor review)`,async generate(context:GenerationContext){
    if(isPacketV2(context.baseline))throw new Error("PROFILE_REUSE_RETIRED: mentor-review cases need their own grounded draft");
    const baseline=context.baseline as Packet;
    const key=digest({domain:context.domain,policy:context.risk.policyVersion,signals:context.risk.signals,codes:baseline.actions.map(a=>a.code)});
    let profile=profiles.get(key);
    if(!profile){stats.profiles++;profile=(async()=>{stats.actualModelCalls++;const result=await provider.generate(context);
      if(!validatePacket(result,context.evidence,context.risk,context.domain).valid)throw new Error("Shared action profile failed validation; use explicit case fallback");
      return packetSchema.parse(result);})();profiles.set(key,profile);
    }else stats.reusedProfiles++;
    const result=await profile;
    return {...baseline,actions:result.actions.map(action=>{
      const own=baseline.actions.find(a=>a.code===action.code);if(!own)throw new Error("Profile action is not applicable to this case");return {...own,dueInDays:action.dueInDays};
    })};
  }};
  return {composer,stats};
}
