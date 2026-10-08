const translationConfig = require('../subtitleTranslation/translationConfig');
const translationQueue = require('../subtitleTranslation/translationQueue');
const translationService = require('../subtitleTranslation/translationService');
const gemini = require('../subtitleTranslation/providers/geminiTranslator');

async function handleGlobalSubtitleTranslationRoutes(req, res, url, deps) {
  if (!url.pathname.startsWith('/api/subtitle-translation/')) return false;
  const action = url.pathname.slice('/api/subtitle-translation/'.length);
  if (req.method === 'GET' && action === 'config') {
    const config = await translationConfig.load(); deps.sendJson(res, 200, { ok: true, result: translationConfig.publicStatus(config) }); return true;
  }
  if (req.method === 'PUT' && action === 'config') {
    const payload = await deps.readJson(req); const config = await translationConfig.save(payload); deps.sendJson(res, 200, { ok: true, result: translationConfig.publicStatus(config) }); return true;
  }
  if (req.method === 'GET' && action === 'models') {
    const config = await translationConfig.load(); const models = await gemini.listModels(config); deps.sendJson(res, 200, { ok: true, result: { models, selected: config.model } }); return true;
  }
  if (req.method === 'POST' && action === 'config/test') {
    const payload = await deps.readJson(req); let config = await translationConfig.load();
    if (String(payload.apiKey || '').trim() || String(payload.model || '').trim()) config = translationConfig.normalize({ ...config, apiKey: String(payload.apiKey || '').trim() || config.apiKey, model: String(payload.model || '').trim() || config.model });
    const result = await gemini.testConnection(config); deps.sendJson(res, 200, { ok: true, result }); return true;
  }
  if (req.method === 'GET' && action === 'status') { deps.sendJson(res, 200, { ok: true, result: await translationQueue.getStatus() }); return true; }
  if (req.method === 'POST' && action === 'pause') { deps.sendJson(res, 200, { ok: true, result: await translationQueue.pause() }); return true; }
  if (req.method === 'POST' && action === 'resume') { deps.sendJson(res, 200, { ok: true, result: await translationQueue.resume() }); return true; }
  if (req.method === 'POST' && action === 'cancel') { const payload = await deps.readJson(req); deps.sendJson(res, 200, { ok: true, result: await translationQueue.cancel(payload.jobId) }); return true; }
  return false;
}

async function handleDestinationSubtitleTranslationAction({ req, res, url, deps, destination, action }) {
  if (!['subtitle-translation-options', 'subtitle-translation-plan', 'subtitle-translation-start'].includes(action)) return false;
  if (req.method === 'GET' && action === 'subtitle-translation-options') {
    const languageCounts = await translationService.getLanguageCounts({ destination, downloadManager: deps.downloadManager });
    const config = await translationConfig.load();
    deps.sendJson(res, 200, { ok: true, result: { languageCounts, config: translationConfig.publicStatus(config) } }); return true;
  }
  if (req.method !== 'POST') return false;
  const payload = await deps.readJson(req);
  const plan = await translationService.buildPlan({ destination, downloadManager: deps.downloadManager, payload });
  if (action === 'subtitle-translation-plan') { deps.sendJson(res, 200, { ok: true, result: plan }); return true; }
  const providerConfig = await translationConfig.load();
  if (!providerConfig.apiKey) { const error = new Error('Configure a API key do Gemini antes de iniciar a traducao.'); error.statusCode = 400; throw error; }
  const job = await translationQueue.startJob(plan); deps.sendJson(res, 202, { ok: true, result: { job, plan } }); return true;
}

module.exports = { handleGlobalSubtitleTranslationRoutes, handleDestinationSubtitleTranslationAction };
