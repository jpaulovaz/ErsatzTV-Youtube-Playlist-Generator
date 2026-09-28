const scriptedService = require('../scriptedSchedules/service');
const { runLibraryAction } = require('../ersatztvService');

async function handleScriptedScheduleRoutes(req, res, url, deps) {
  if (!url.pathname.startsWith('/api/scripted-schedules')) return false;

  if (req.method === 'GET' && url.pathname === '/api/scripted-schedules/settings') {
    deps.sendJson(res, 200, { ok: true, settings: await scriptedService.getSettings() });
    return true;
  }
  if (req.method === 'PUT' && url.pathname === '/api/scripted-schedules/settings') {
    const settings = await scriptedService.saveSettings(await deps.readJson(req));
    deps.sendJson(res, 200, { ok: true, settings });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/scripted-schedules') {
    deps.sendJson(res, 200, { ok: true, projects: await scriptedService.listProjects() });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/scripted-schedules') {
    const project = await scriptedService.createProject(await deps.readJson(req));
    deps.sendJson(res, 201, { ok: true, project });
    return true;
  }

  const match = url.pathname.match(/^\/api\/scripted-schedules\/([^/]+)(?:\/(.+))?$/);
  if (!match) {
    deps.sendJson(res, 404, { ok: false, error: 'Endpoint de Scripted Schedules nao encontrado.' });
    return true;
  }
  const id = decodeURIComponent(match[1]);
  const action = match[2] || '';

  if (req.method === 'GET' && !action) {
    deps.sendJson(res, 200, { ok: true, project: await scriptedService.getProject(id) });
    return true;
  }

  if (req.method === 'PUT' && !action) {
    try {
      const result = await scriptedService.updateAndPublish(id, await deps.readJson(req));
      deps.sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      if (error.validation) {
        deps.sendJson(res, error.statusCode || 400, { ok: false, error: error.message, code: error.code || null, validation: error.validation });
        return true;
      }
      throw error;
    }
    return true;
  }

  if (req.method === 'DELETE' && !action) {
    const payload = await deps.readJson(req);
    const result = await scriptedService.deleteProject(id, { removePublished: Boolean(payload.removePublished) });
    deps.sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (req.method === 'POST' && action === 'validate') {
    const validation = await scriptedService.validateDraft(id, await deps.readJson(req));
    deps.sendJson(res, validation.ok ? 200 : 400, { ok: validation.ok, validation });
    return true;
  }

  if (req.method === 'GET' && action === 'preview') {
    const result = await scriptedService.previewProject(id);
    deps.sendJson(res, 200, { ok: true, script: result.script, project: { id: result.project.id, name: result.project.name, fileName: result.project.fileName } });
    return true;
  }
  if (req.method === 'POST' && action === 'preview') {
    try {
      const result = await scriptedService.previewDraft(id, await deps.readJson(req));
      deps.sendJson(res, 200, { ok: true, script: result.script, project: { id: result.project.id, name: result.project.name, fileName: result.project.fileName } });
    } catch (error) {
      if (error.validation) {
        deps.sendJson(res, error.statusCode || 400, { ok: false, error: error.message, code: error.code || null, validation: error.validation });
        return true;
      }
      throw error;
    }
    return true;
  }

  if (req.method === 'POST' && action === 'duplicate') {
    const project = await scriptedService.duplicateProject(id);
    deps.sendJson(res, 201, { ok: true, project });
    return true;
  }

  if (req.method === 'GET' && action === 'history') {
    deps.sendJson(res, 200, { ok: true, history: await scriptedService.getHistory(id) });
    return true;
  }

  if (req.method === 'POST' && action === 'restore') {
    const payload = await deps.readJson(req);
    try {
      const result = await scriptedService.restoreRevision(id, payload.revisionId);
      deps.sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      if (error.validation) {
        deps.sendJson(res, error.statusCode || 400, { ok: false, error: error.message, code: error.code || null, validation: error.validation });
        return true;
      }
      throw error;
    }
    return true;
  }

  if (req.method === 'GET' && action === 'link-assistant') {
    deps.sendJson(res, 200, { ok: true, assistant: await scriptedService.getLinkAssistant(id) });
    return true;
  }

  if (req.method === 'POST' && action === 'reset-playout') {
    const payload = await deps.readJson(req);
    const channelNumber = String(payload.channelNumber || '').trim();
    const project = await scriptedService.getProject(id);
    const link = (project.channelLinks || []).find((item) => String(item.channelNumber || '') === channelNumber);
    if (!link) {
      deps.sendJson(res, 400, { ok: false, error: 'Canal nao esta vinculado localmente a este projeto.' });
      return true;
    }
    const config = await deps.loadConfig();
    const result = await runLibraryAction(config, {
      channelNumber,
      name: link.channelName || project.name,
      folderName: project.name
    }, 'reset-playout');
    deps.sendJson(res, result.ok ? 200 : 502, { ok: result.ok, result });
    return true;
  }

  deps.sendJson(res, 404, { ok: false, error: 'Endpoint de Scripted Schedules nao encontrado.' });
  return true;
}

module.exports = { handleScriptedScheduleRoutes };
