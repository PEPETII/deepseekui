// 模板背景图：本地校验、预览、存储
let activeTemplateBackground = normalizeTemplateBackground(DEFAULTS[BACKGROUND_KEY]);

function setBackgroundStatus(text) {
  try { $('background-status').textContent = text; } catch {}
}

function setBackgroundTip(text) {
  try { $('tip').textContent = text; } catch {}
}

function formatBackgroundBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function backgroundMimeFromFile(file) {
  const type = String(file?.type || '').toLowerCase();
  if (BACKGROUND_MIME_TYPES.includes(type)) return type;
  if (type === 'image/jpg') return 'image/jpeg';
  if (type && type !== 'application/octet-stream') return '';
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return '';
}

function validateBackgroundFile(file) {
  if (!file) return { ok: false, reason: '未选择图片文件。' };
  const mimeType = backgroundMimeFromFile(file);
  if (!mimeType) return { ok: false, reason: '格式不支持，仅支持 PNG、JPG 或 JPEG。' };
  const size = Number(file.size) || 0;
  if (size <= 0) return { ok: false, reason: '图片文件为空，请重新选择。' };
  if (size > BACKGROUND_MAX_BYTES) return { ok: false, reason: '图片不能超过 5 MB。' };
  return { ok: true, mimeType, size };
}

function readBackgroundFile(file) {
  const checked = validateBackgroundFile(file);
  if (!checked.ok) return Promise.reject(new Error(checked.reason));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败，请重试。'));
    reader.onload = () => {
      const raw = String(reader.result || '');
      const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : '';
      const dataUrl = `data:${checked.mimeType};base64,${base64}`;
      if (!base64) { reject(new Error('图片内容为空或已损坏。')); return; }
      const image = new Image();
      image.onerror = () => reject(new Error('图片内容无法解析，请选择有效的 PNG 或 JPG。'));
      image.onload = () => {
        const width = Number(image.naturalWidth || image.width) || 0;
        const height = Number(image.naturalHeight || image.height) || 0;
        if (!width || !height) { reject(new Error('图片尺寸无效，请重新选择。')); return; }
        resolve({
          dataUrl,
          mimeType: checked.mimeType,
          name: String(file.name || '').trim().slice(0, 120),
          size: checked.size,
          width,
          height,
        });
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function defaultBackgroundUrl() {
  try { return chrome.runtime.getURL('assets/backgrounds/main-background.png'); } catch { return ''; }
}

function paintBackgroundConfig(value) {
  const cfg = normalizeTemplateBackground(value);
  activeTemplateBackground = cfg;
  const toggle = $('background-toggle');
  const state = $('background-state');
  const upload = $('background-upload');
  const remove = $('background-remove');
  const image = $('background-preview');
  const empty = $('background-preview-empty');
  const info = $('background-info');
  if (!toggle || !state || !upload || !remove || !image || !empty || !info) return;
  toggle.setAttribute('aria-checked', String(cfg.enabled));
  state.textContent = cfg.enabled ? '已开启' : '已关闭';
  upload.textContent = cfg.dataUrl ? '重新上传' : '上传背景图';
  remove.disabled = !cfg.dataUrl;
  if (cfg.enabled) {
    const src = cfg.dataUrl || defaultBackgroundUrl();
    image.hidden = !src;
    if (src) image.src = src;
    empty.hidden = !!src;
    empty.textContent = '暂无可预览的背景图';
    info.textContent = cfg.dataUrl
      ? `${cfg.name || '自定义图片'} · ${cfg.width && cfg.height ? `${cfg.width}×${cfg.height} · ` : ''}${formatBackgroundBytes(cfg.size)}`
      : '内置默认图 · 1920×1080 · 16:9';
  } else {
    image.hidden = true;
    image.removeAttribute('src');
    empty.hidden = false;
    empty.textContent = '已关闭，页面使用站点默认背景';
    info.textContent = cfg.dataUrl ? '已保留自定义图片，重新开启后继续使用' : '页面使用站点默认背景';
  }
}

function setBackgroundBusy(on) {
  ['background-toggle', 'background-upload', 'background-remove'].forEach(id => {
    const el = $(id);
    if (el) el.disabled = !!on;
  });
  const card = $('background-card');
  if (card) card.setAttribute('aria-busy', String(!!on));
}

// 选择新图片即视为用户要立即使用它，避免上传成功后仍沿用旧的关闭状态。
function backgroundConfigAfterUpload(value) {
  return { ...normalizeTemplateBackground(value), enabled: true };
}

async function persistTemplateBackground(value, note) {
  const cfg = normalizeTemplateBackground(value);
  try { await chrome.storage.local.set({ [BACKGROUND_KEY]: cfg }); }
  catch {
    setBackgroundStatus('保存失败：本地存储空间不足，旧背景配置未改变。');
    setBackgroundTip('背景图保存失败：本地存储空间不足或写入被拒绝。');
    return false;
  }
  paintBackgroundConfig(cfg);
  let s = { ...DEFAULTS, [BACKGROUND_KEY]: cfg };
  try { s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }; } catch {}
  s[BACKGROUND_KEY] = cfg;
  await notify({ type: 'DOCDEEP_SETTINGS', settings: s });
  if (note) setBackgroundTip(note);
  return true;
}

async function handleBackgroundUpload(file) {
  const checked = validateBackgroundFile(file);
  if (!checked.ok) {
    setBackgroundStatus(`上传失败：${checked.reason}`);
    setBackgroundTip(`背景图上传失败：${checked.reason}`);
    return false;
  }
  setBackgroundBusy(true);
  setBackgroundStatus('正在读取背景图…');
  try {
    const next = await readBackgroundFile(file);
    const ok = await persistTemplateBackground(backgroundConfigAfterUpload(next));
    if (ok) setBackgroundStatus(`已保存并开启：${next.width}×${next.height} · ${formatBackgroundBytes(next.size)}`);
    return ok;
  } catch (error) {
    const reason = error?.message || '读取失败，请重试。';
    setBackgroundStatus(`上传失败：${reason}`);
    setBackgroundTip(`背景图上传失败：${reason}`);
    return false;
  } finally {
    setBackgroundBusy(false);
    paintBackgroundConfig(activeTemplateBackground);
  }
}

function initBackgroundSettings() {
  paintBackgroundConfig(DEFAULTS[BACKGROUND_KEY]);
  const toggle = $('background-toggle');
  const upload = $('background-upload');
  const remove = $('background-remove');
  const input = $('background-file');
  if (!toggle || !upload || !remove || !input) return;
  toggle.addEventListener('click', async () => {
    const enabled = toggle.getAttribute('aria-checked') !== 'true';
    const ok = await persistTemplateBackground({ ...activeTemplateBackground, enabled }, enabled ? '背景图已开启。' : '背景图已关闭，页面恢复默认背景。');
    if (ok) setBackgroundStatus(enabled ? '已开启' : '已关闭');
  });
  upload.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    await handleBackgroundUpload(input.files?.[0]);
    try { input.value = ''; } catch {}
  });
  remove.addEventListener('click', async () => {
    const ok = await persistTemplateBackground({ ...activeTemplateBackground, dataUrl: '', mimeType: '', name: '', size: 0, width: 0, height: 0 }, '自定义背景图已删除，已回退到内置默认图。');
    if (ok) setBackgroundStatus(activeTemplateBackground.enabled ? '已回退到内置默认图' : '已删除自定义背景图');
  });
}
