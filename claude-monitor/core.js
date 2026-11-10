'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const numeric = v => Number.isFinite(v) && v >= 0 ? v : 0;
function clean(v, max = 150) { return String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max); }
function normalize(p) { const s = path.resolve(p); return process.platform === 'win32' ? s.toLowerCase() : s; }
function belongs(cwd, roots) { return !!cwd && roots.some(r => { const rel = path.relative(normalize(r), normalize(cwd)); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }); }

class Transcript {
  constructor(file) { this.file = file; this.reset(); }
  reset() {
    this.offset = 0; this.decoder = new StringDecoder('utf8'); this.pending = ''; this.messages = new Map();
    this.tools = new Map(); this.cwd = ''; this.model = ''; this.sessionId = ''; this.lastTime = 0;
    this.lastUsage = null; this.lastUsageTime = 0; this.partial = false; this.identity = null;
  }
  accept(r) {
    const time = Date.parse(r.timestamp) || 0;
    if (r.cwd) this.cwd = r.cwd;
    if (r.sessionId) this.sessionId = r.sessionId;
    this.lastTime = Math.max(this.lastTime, time);
    const m = r.message;
    if (!m || !['assistant', 'user'].includes(r.type)) return;
    if (r.type === 'assistant') {
      if (m.model) this.model = clean(m.model);
      if (m.usage && (m.id || r.requestId || r.uuid)) {
        const key = m.id || r.requestId || r.uuid;
        const u = { input: numeric(m.usage.input_tokens), output: numeric(m.usage.output_tokens),
          cacheRead: numeric(m.usage.cache_read_input_tokens), cacheWrite: numeric(m.usage.cache_creation_input_tokens) };
        const old = this.messages.get(key);
        if (old) for (const k of Object.keys(u)) u[k] = Math.max(u[k], old[k]);
        this.messages.set(key, u);
        if (time >= this.lastUsageTime) { this.lastUsage = u; this.lastUsageTime = time; }
      }
    }
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type === 'tool_use' && c.id) {
        const old = this.tools.get(c.id);
        const input = c.input || {};
        // Only paths and agent descriptions; never copy shell commands, prompts or tool results.
        const detail = input.file_path || input.path || (['Agent', 'Task'].includes(c.name) ? input.description || input.subagent_type : '');
        this.tools.set(c.id, { id: c.id, name: clean(c.name), detail: clean(detail), time, done: old?.done || false, error: old?.error || false });
      }
      if (c.type === 'tool_result' && c.tool_use_id) {
        const t = this.tools.get(c.tool_use_id);
        if (t) { t.done = true; t.error = !!c.is_error; }
      }
    }
    // Bound activity history without discarding unfinished calls.
    if (this.tools.size > 500) for (const [id, t] of this.tools) { if (this.tools.size <= 400) break; if (t.done) this.tools.delete(id); }
  }
  feed(bytes) {
    this.pending += this.decoder.write(bytes);
    let pos;
    while ((pos = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, pos); this.pending = this.pending.slice(pos + 1);
      try { this.accept(JSON.parse(line)); } catch { /* Skip malformed lines; an unfinished final line waits for the next poll. */ }
    }
  }
  async update() {
    const handle = await fs.open(this.file, 'r');
    try {
      const stat = await handle.stat();
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      if ((this.identity && this.identity !== identity) || stat.size < this.offset) this.reset();
      this.identity = identity;
      // Avoid blocking the extension host on an unexpectedly huge history.
      const end = Math.min(stat.size, this.offset + 8 * 1024 * 1024);
      const buffer = Buffer.alloc(128 * 1024);
      while (this.offset < end) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - this.offset), this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead; this.feed(buffer.subarray(0, bytesRead));
      }
      this.partial = this.offset < stat.size;
    } finally { await handle.close(); }
  }
  totals() {
    const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const u of this.messages.values()) for (const key of Object.keys(out)) out[key] += u[key];
    return out;
  }
}

class Monitor {
  constructor() { this.cache = new Map(); this.sessions = []; this.error = ''; }
  async scan(root, workspaces, onlyWorkspace) {
    let dirs;
    try { dirs = await fs.readdir(root, { withFileTypes: true }); }
    catch (e) { this.error = e.code === 'ENOENT' ? 'Pasta de registros não encontrada. Confira Claude Monitor: Projects Path.' : `Não foi possível ler os registros (${e.code || 'erro'}).`; this.sessions = []; return; }
    const candidates = [];
    for (const d of dirs.filter(d => d.isDirectory() && !d.isSymbolicLink())) {
      const folder = path.join(root, d.name);
      // Claude encodes absolute project paths using a dash for punctuation.
      // For workspace filtering, shortlist encoded directories before reading content.
      if (onlyWorkspace && !workspaces.some(w => {
        const a = normalize(w).replace(/[^a-zA-Z0-9]/g, '-');
        return d.name.toLowerCase() === a.toLowerCase() || d.name.toLowerCase().startsWith(a.toLowerCase() + '-');
      })) continue;
      let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) if (e.isFile() && e.name.endsWith('.jsonl')) {
        const file = path.join(folder, e.name);
        try { const st = await fs.stat(file); candidates.push({ file, mtime: st.mtimeMs }); } catch {}
      }
    }
    candidates.sort((a,b) => b.mtime-a.mtime);
    const sessions = []; const keep = new Set();
    let failures = 0;
    for (const {file} of candidates.slice(0, 30)) {
      const t = this.cache.get(file) || new Transcript(file); keep.add(file); this.cache.set(file,t);
      try { await t.update(); } catch { failures++; continue; }
      if (onlyWorkspace && !belongs(t.cwd,workspaces)) continue;
      const agents = [];
      const folder = path.join(path.dirname(file), path.basename(file,'.jsonl'),'subagents');
      let entries = []; try { entries = await fs.readdir(folder,{withFileTypes:true}); } catch {}
      const agentFiles = [];
      for (const e of entries) if (e.isFile() && e.name.endsWith('.jsonl')) {
        const f = path.join(folder,e.name); try { agentFiles.push({file:f,mtime:(await fs.stat(f)).mtimeMs}); } catch {}
      }
      agentFiles.sort((a,b)=>b.mtime-a.mtime);
      for (const {file:f} of agentFiles.slice(0,30)) {
        const a = this.cache.get(f) || new Transcript(f); keep.add(f); this.cache.set(f,a);
        try { await a.update(); agents.push(a); } catch { failures++; }
      }
      sessions.push({main:t,agents,moreAgents:Math.max(0,agentFiles.length-30)});
    }
    for (const file of this.cache.keys()) if (!keep.has(file)) this.cache.delete(file);
    this.sessions = sessions;
    this.error = failures ? `${failures} registro(s) não puderam ser lidos.` : '';
  }
}
module.exports = { Transcript, Monitor, belongs, clean };
