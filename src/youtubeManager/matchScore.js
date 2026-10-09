function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(official\s*(music\s*)?video|official\s*audio|lyrics?|hd|4k|remaster(?:ed)?|visualizer)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return new Set(normalizeText(value).split(' ').filter(Boolean));
}

function similarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = tokens(a); const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  const union = new Set([...aa, ...bb]).size;
  const jaccard = union ? intersection / union : 0;
  const containment = Math.min(1, intersection / Math.max(1, Math.min(aa.size, bb.size)));
  return Math.max(jaccard, containment * 0.92);
}

function durationScore(localSeconds, remoteSeconds) {
  const a = Number(localSeconds); const b = Number(remoteSeconds);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return { points: 0, differenceSeconds: null };
  const diff = Math.abs(a - b);
  const percent = diff / Math.max(a, b);
  let points = 0;
  if (diff <= 2 || percent <= 0.01) points = 25;
  else if (diff <= 5 || percent <= 0.025) points = 22;
  else if (diff <= 10 || percent <= 0.05) points = 17;
  else if (diff <= 20 || percent <= 0.1) points = 10;
  else if (diff <= 45 || percent <= 0.2) points = 4;
  return { points, differenceSeconds: diff };
}

function scoreCandidate(item, candidate) {
  const localTitle = item.inferredTitle || item.title || '';
  const localArtist = item.inferredArtist || item.artist || '';
  const remoteTitle = candidate.title || '';
  const channelTitle = candidate.channelTitle || '';
  const normalizedArtist = normalizeText(localArtist);
  const normalizedRemoteTitle = normalizeText(remoteTitle);
  const titleWithoutArtist = normalizedArtist && normalizedRemoteTitle.startsWith(`${normalizedArtist} `)
    ? normalizedRemoteTitle.slice(normalizedArtist.length + 1)
    : normalizedRemoteTitle;

  const titleRatio = Math.max(similarity(localTitle, remoteTitle), similarity(localTitle, titleWithoutArtist));
  const artistRatio = Math.max(similarity(localArtist, channelTitle), similarity(localArtist, remoteTitle));
  const titlePoints = Math.round(45 * titleRatio);
  const artistPoints = localArtist && normalizeText(localArtist) !== 'outros' ? Math.round(25 * artistRatio) : 0;
  const duration = durationScore(item.duration, candidate.duration);
  let other = 0;
  const localYear = Number(item.year);
  const remoteYear = candidate.publishedAt ? new Date(candidate.publishedAt).getUTCFullYear() : null;
  if (Number.isFinite(localYear) && Number.isFinite(remoteYear) && localYear === remoteYear) other += 3;
  if (/official/i.test(remoteTitle) || /official/i.test(channelTitle)) other += 2;
  const total = Math.max(0, Math.min(100, titlePoints + artistPoints + duration.points + other));
  const level = total >= 92 ? 'high' : total >= 75 ? 'probable' : 'weak';
  return {
    total,
    level,
    breakdown: { title: titlePoints, artist: artistPoints, duration: duration.points, other },
    durationDifferenceSeconds: duration.differenceSeconds
  };
}

module.exports = { normalizeText, similarity, durationScore, scoreCandidate };
