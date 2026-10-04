function normalize(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value) {
  return new Set(normalize(value).split(' ').filter(Boolean));
}

function similarity(a, b) {
  const na = normalize(a); const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na); const tb = tokens(nb);
  const intersection = [...ta].filter((token) => tb.has(token)).length;
  const union = new Set([...ta, ...tb]).size || 1;
  return intersection / union;
}

function versionWarning(queryTrack, candidateTrack) {
  const flags = ['live', 'remix', 'acoustic', 'karaoke', 'instrumental', 'sped up', 'slowed', 'edit', 'version'];
  const q = normalize(queryTrack);
  const c = normalize(candidateTrack);
  for (const flag of flags) {
    const qHas = q.includes(flag);
    const cHas = c.includes(flag);
    if (qHas !== cHas) return `Possivel versao divergente (${flag}).`;
  }
  return '';
}

function scoreCandidate(query, candidate, videoDurationSeconds) {
  let score = 0;
  const title = similarity(query.track, candidate.trackName);
  const artist = similarity(query.artist, candidate.artistName);
  score += Math.round(title * 45);
  score += Math.round(artist * 35);
  if (query.album) score += Math.round(similarity(query.album, candidate.albumName) * 5);
  else score += 5;

  const duration = Number(candidate.duration);
  const reference = Number(videoDurationSeconds);
  let durationDelta = null;
  if (duration > 0 && reference > 0) {
    durationDelta = Math.abs(duration - reference);
    if (durationDelta <= 2) score += 15;
    else if (durationDelta <= 5) score += 12;
    else if (durationDelta <= 10) score += 9;
    else if (durationDelta <= 20) score += 5;
    else if (durationDelta <= 45) score += 2;
  }

  const warning = versionWarning(query.track, candidate.trackName);
  if (warning) score -= 12;
  score = Math.max(0, Math.min(100, score));
  const label = score >= 90 ? 'Excelente' : score >= 75 ? 'Muito boa' : score >= 60 ? 'Boa' : 'Revisar';
  return { score, label, durationDeltaSeconds: durationDelta, warnings: warning ? [warning] : [] };
}

module.exports = { normalize, similarity, scoreCandidate };
