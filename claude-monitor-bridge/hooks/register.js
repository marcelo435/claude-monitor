// Runs inside Claude Code's documented mod host, which has no Node.js globals.
// Deliberately observes only; it never calls models, auth APIs, prompts or tools.
  let timer, writing = false, ended = false, lastLimits = '', limitsChangedAt = '', current;
  let phase = 'idle';
  const history = [];
  const text = (v, max = 180) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max);
  const num = v => Number.isFinite(v) && v >= 0 ? v : undefined;
  async function publish($, measurement) {
    if (writing || ended) return;
    writing = true;
    try {
      const id = await $.session.id();
      if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return;
      const usage = measurement || await $.session.usage();
      const agents = await $.agent.list();
      const now = new Date().toISOString();
      const limits = (usage.rateLimits || []).map(w => ({ kind: text(w.kind,64), percentUsed: num(w.percentUsed), resetsAt: w.resetsAt }))
        .filter(w => w.kind && w.percentUsed !== undefined);
      const serialized = JSON.stringify(limits);
      if (serialized !== lastLimits) { lastLimits = serialized; limitsChangedAt = now; }
      current = {
        schema: 1, sessionId: id, cwd: await $.session.cwd(), model: await $.session.model(),
        publishedAt: now, limitsChangedAt, ended: false, phase,
        context: { tokens: num(usage.context?.tokens), window: num(usage.context?.window), percent: num(usage.context?.percent) },
        rateLimits: limits,
        agents: agents.slice(0,100).map(a => ({ id: text(a.id,128), name: text(a.name || a.description || a.type), type: text(a.type), status: text(a.status,32), parentId: a.parentId ? text(a.parentId,128) : undefined })),
        activity: history.slice(-40).reverse()
      };
      const config = await $.env.get('CLAUDE_CONFIG_DIR');
      const home = config ? '' : (await $.env.get('USERPROFILE') || await $.env.get('HOME'));
      if (!config && !home) return;
      const root = String(config || `${home}/.claude`).replace(/[\\/]$/, '');
      await $.fs.write(`${root}/claude-monitor/sessions/${id}.json`, JSON.stringify(current));
    } catch { /* Monitoring failures must never block Claude's work. */ }
    finally { writing = false; }
  }
export function register(on) {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    ended = false;
    timer?.cancel();
    await publish($);
    timer = $.clock.every(2000, () => { void publish($); });
    return result;
  });
  on('session.measure', async ($, e, next) => {
    const result = await next(e);
    await publish($,e);
    return result;
  });
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) { phase = 'working'; await publish($); }
    return next(e);
  });
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId) phase = 'idle';
    await publish($);
    return result;
  });
  on('tool.call', async ($, e, next) => {
    const item = { id: text(e.tool_use_id,128), agentId: text(e.agentId || '',128), name: text(e.tool,80),
      detail: text(e.file_path || e.path || (e.tool === 'Agent' ? e.description : '')),
      time: new Date().toISOString(), status: 'running' };
    history.push(item); if(history.length > 40) history.shift();
    await publish($);
    try { const result = await next(e); item.status = result?.isError ? 'failed' : 'completed'; return result; }
    catch(error) { item.status = 'failed'; throw error; }
    finally { await publish($); }
  });
  on('session.end', async ($, e, next) => {
    ended = true; timer?.cancel();
    if (current) {
      try {
        const config = await $.env.get('CLAUDE_CONFIG_DIR');
        const home = config ? '' : (await $.env.get('USERPROFILE') || await $.env.get('HOME'));
        if (config || home) await $.fs.write(`${String(config || `${home}/.claude`).replace(/[\\/]$/, '')}/claude-monitor/sessions/${current.sessionId}.json`,
          JSON.stringify({ ...current, ended: true, phase: 'ended', publishedAt: new Date().toISOString() }));
      } catch {}
    }
    return next(e);
  });
}
