function normalizeDateOnly(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  if (/^\d{8}$/.test(text)) {
    const year = text.slice(0, 4);
    const month = text.slice(4, 6);
    const day = text.slice(6, 8);
    const iso = `${year}-${month}-${day}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso) return iso;
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text) return text;
    return null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function timestampToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const parsed = new Date(number * 1000);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function releaseMetadataFromVideo(video) {
  const source = video && typeof video === 'object' ? video : {};
  const publishedAt = String(source.publishedAt || '').trim() || timestampToIso(source.timestamp) || null;
  const uploadDate = String(source.uploadDate || source.upload_date || '').trim() || null;
  const releaseDate = normalizeDateOnly(publishedAt) || normalizeDateOnly(uploadDate) || normalizeDateOnly(source.releaseDate);
  const yearFromDate = releaseDate ? Number(releaseDate.slice(0, 4)) : null;
  const rawYear = Number(source.year || source.release_year);
  const year = Number.isInteger(yearFromDate) && yearFromDate > 0
    ? yearFromDate
    : (Number.isInteger(rawYear) && rawYear > 0 ? rawYear : null);

  return {
    publishedAt,
    uploadDate,
    releaseDate: releaseDate || null,
    releaseDateSource: releaseDate ? 'youtube' : null,
    year
  };
}

function mergeReleaseMetadata(existing, incoming) {
  const current = existing && typeof existing === 'object' ? existing : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const releaseDate = next.releaseDate || current.releaseDate || null;
  const yearFromDate = releaseDate ? Number(String(releaseDate).slice(0, 4)) : null;
  return {
    publishedAt: next.publishedAt || current.publishedAt || null,
    uploadDate: next.uploadDate || current.uploadDate || null,
    releaseDate,
    releaseDateSource: next.releaseDateSource || current.releaseDateSource || null,
    year: Number.isInteger(yearFromDate) && yearFromDate > 0
      ? yearFromDate
      : (Number(next.year) || Number(current.year) || null)
  };
}

module.exports = {
  normalizeDateOnly,
  releaseMetadataFromVideo,
  mergeReleaseMetadata
};
