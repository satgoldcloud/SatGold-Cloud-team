export async function getSchoolEntitlements(admin,schoolId) {
  const { data:subscription,error } = await admin.from('school_subscriptions')
    .select('id,status,trial_ends_at,subscription_plans(entitlements)')
    .eq('school_id',schoolId).in('status',['trialing','active']).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if (error) throw error;
  if (!subscription || (subscription.status==='trialing' && (!subscription.trial_ends_at || Date.parse(subscription.trial_ends_at)<=Date.now()))) return null;
  return { subscription,entitlements:subscription.subscription_plans?.entitlements || {} };
}

export function exceedsEntitlement(entitlements,key,currentCount,addition=1) {
  const limit=entitlements?.[key];
  return Number.isFinite(Number(limit)) && Number(limit)>=0 && currentCount+addition>Number(limit);
}
