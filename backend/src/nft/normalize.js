// Normalizes raw OpenSea drop payloads into one internal shape and computes
// the drop status server-side.
//
// Phase 1 rebuild: is_minting is the authoritative live flag. Times/price
// come from active_stage. next_stage gives real "upcoming". Supply-based
// sold-out logic dropped (data no longer exists in API).

export function classifyStatus({ startTime, endTime, isMinting }, now = Date.now()) {
  // is_minting is the single authoritative source for "live right now"
  if (isMinting === true) return 'live';
  if (isMinting === false) {
    // Was minting, now stopped → ended
    if (endTime && endTime < now) return 'ended';
    // Might just be between stages — check if upcoming stage exists
    if (startTime && startTime > now) return 'upcoming';
    return 'ended';
  }
  // No is_minting data (older drops or API edge case) — fall back to time checks
  if (!startTime && !endTime) return 'unknown';
  if (startTime && startTime > now) return 'upcoming';
  if (endTime && endTime < now) return 'ended';
  if (startTime && startTime <= now && (!endTime || endTime >= now)) return 'live';
  return 'unknown';
}

export function mintPageUrl(slug) {
  return `https://opensea.io/collection/${slug}/overview`;
}

// raw: one drop object from the OpenSea recently_minted endpoint.
// Phase 1: uses is_minting, active_stage, next_stage, opensea_url.
export function normalizeDrop(raw, now = Date.now()) {
  const slug = raw.collection_slug || raw.slug;
  if (!slug) return null;

  const chain = raw.chain || null;
  if (!chain) return null;

  const isMinting = raw.is_minting ?? null;

  // Build stages from active_stage + next_stage
  const rawActiveStage = raw.active_stage || null;
  const rawNextStage = raw.next_stage || null;
  const stages = [];
  if (rawActiveStage) {
    stages.push({
      uuid: rawActiveStage.uuid || null,
      label: rawActiveStage.label || rawActiveStage.stage_type || 'mint',
      stageType: rawActiveStage.stage_type || null,
      priceWei: rawActiveStage.price ?? '0',
      startTime: rawActiveStage.start_time ? new Date(rawActiveStage.start_time).getTime() : null,
      endTime: rawActiveStage.end_time ? new Date(rawActiveStage.end_time).getTime() : null,
      maxPerWallet: rawActiveStage.max_per_wallet ?? null,
      isActive: true,
    });
  }
  if (rawNextStage) {
    stages.push({
      uuid: rawNextStage.uuid || null,
      label: rawNextStage.label || rawNextStage.stage_type || 'next',
      stageType: rawNextStage.stage_type || null,
      priceWei: rawNextStage.price ?? '0',
      startTime: rawNextStage.start_time ? new Date(rawNextStage.start_time).getTime() : null,
      endTime: rawNextStage.end_time ? new Date(rawNextStage.end_time).getTime() : null,
      maxPerWallet: rawNextStage.max_per_wallet ?? null,
      isActive: false,
    });
  }
  // Back-compat: stages[] array
  const rawStagesArr = raw.stages || [];
  for (const s of rawStagesArr) {
    stages.push({
      uuid: s.uuid || null,
      label: s.label || s.stage_type || 'mint',
      stageType: s.stage_type || null,
      priceWei: s.price ?? '0',
      startTime: s.start_time ? new Date(s.start_time).getTime() : null,
      endTime: s.end_time ? new Date(s.end_time).getTime() : null,
      maxPerWallet: s.max_per_wallet ?? null,
      isActive: s.stage_type === 'live' || s.stage_type === 'minting',
    });
  }

  const seenStages = new Set();
  const uniqueStages = [];
  for (const s of stages) {
    const key = s.uuid || `${s.label}|${s.startTime}|${s.priceWei}`;
    if (seenStages.has(key)) continue;
    seenStages.add(key);
    uniqueStages.push(s);
  }
  // Chronological order so mint phases read like a schedule (nulls last).
  uniqueStages.sort((a, b) => {
    if (a.startTime == null && b.startTime == null) return 0;
    if (a.startTime == null) return 1;
    if (b.startTime == null) return -1;
    return a.startTime - b.startTime;
  });

  const startTime = uniqueStages.reduce(
    (min, s) => (s.startTime != null && (min == null || s.startTime < min) ? s.startTime : min), null);
  const endTime = uniqueStages.reduce(
    (max, s) => (s.endTime != null && (max == null || s.endTime > max) ? s.endTime : max), null);
  const activeStartTime = uniqueStages.find(s => s.isActive)?.startTime ?? startTime;

  return {
    slug,
    name: raw.collection_name || raw.name || slug,
    chain,
    contract: raw.contract_address || raw.address || null,
    image: raw.image_url || raw.image || null,
    isMinting,
    status: classifyStatus({ startTime, endTime, isMinting }, now),
    totalSupply: raw.total_supply ?? null,
    maxSupply: raw.max_supply ?? null,
    stages: uniqueStages,
    startTime,
    activeStartTime,
    endTime,
    priceWei: raw.price ?? rawActiveStage?.price ?? null,
    openseaUrl: mintPageUrl(slug),
    nextStageStart: rawNextStage?.start_time ? new Date(rawNextStage.start_time).getTime() : null,
    mintPageUrl: mintPageUrl(slug),
  };
}
