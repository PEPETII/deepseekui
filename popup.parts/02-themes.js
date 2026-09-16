// ---- 外观模板（「模板」分区）----
// 模板 = 对纸张主题档位（docdeep_theme）的具名预设。当前只开一档：
// 橙色（= 现有默认外观 mi）。纯白 bai / 墨色 mo 只在「阅读」下拉可达，不占模板位（深色卡已于 v0.3.40 下线）。
// 新增模板只需往这里加一项 + 在 popup.html 加一张 .skin 卡，不动主题机制。
const TEMPLATES = [
  { id: 'mi', name: '橙色', desc: '当前外观 · 米黄纸面 + 赤陶点睛' },
];
// 合法纸张主题档位全集（含仅下拉可达的 bai/mo）：applyTheme 白名单以此为准，不以 TEMPLATES 为准
const THEME_SLOTS = ['mi', 'bai', 'mo'];

// 纯函数：当前主题命中的模板 id；未命中（如 bai/mo 或脏数据）返回 null —— 不选任何卡，而不是错误高亮
function activeTemplate(theme) {
  const t = String(theme ?? '');
  return TEMPLATES.some(item => item.id === t) ? t : null;
}

// 渲染模板卡选中态（只改注入面板内的类名与 aria，不碰业务数据）
function paintTemplates(theme) {
  const active = activeTemplate(theme);
  let nodes = [];
  try { nodes = [...document.querySelectorAll('.skin[data-skin]')]; } catch { return; }
  nodes.forEach(el => {
    const on = el.dataset.skin === active;
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

// 即时应用主题：popup 自身换肤 + 落盘 + 通知内容脚本；模板卡与「阅读」的下拉共用这一条路径
async function applyTheme(value, note) {
  const theme = String(value ?? '');
  if (!THEME_SLOTS.includes(theme)) return false;
  document.documentElement.dataset.theme = (theme === 'mo') ? 'dark' : 'light';
  paintTemplates(theme);
  try { $('theme').value = theme; } catch {} // 反向同步下拉，避免两个入口显示不一致
  if (typeof chrome === 'undefined' || !chrome.storage) return false;
  try { await chrome.storage.local.set({ docdeep_theme: theme }); }
  catch { try { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; } catch {} return false; }
  let s = { ...DEFAULTS };
  try { s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }; } catch {}
  await notify({ type: 'DOCDEEP_SETTINGS', settings: s });
  if (note) { try { $('tip').textContent = note; } catch {} }
  return true;
}

// 模板卡点击接线：任何文档环境都接（扩展面板 / 本地预览），applyTheme 内部对无 chrome 环境安全返回
function initTemplates() {
  let nodes = [];
  try { nodes = [...document.querySelectorAll('.skin[data-skin]')]; } catch { return; }
  nodes.forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.skin;
      const tpl = TEMPLATES.find(item => item.id === id);
      applyTheme(id, tpl ? `已应用「${tpl.name}」模板，当前页面立即生效。` : '');
    });
  });
}

function paint(s) {
  $('sw').setAttribute('aria-checked', String(s.docdeep_enabled !== false));
  $('ol').setAttribute('aria-checked', String(s.docdeep_outline !== false));
  $('keys').setAttribute('aria-checked', String(s.docdeep_keys !== false));
  $('nav').setAttribute('aria-checked', String(s.docdeep_hide_native === true));
  $('format').setAttribute('aria-checked', String(s.docdeep_format !== false));
  $('addtobox').setAttribute('aria-checked', String(s.docdeep_addtobox !== false));
  $('hidethink').setAttribute('aria-checked', String(s.docdeep_hide_think !== false));
  $('width').value = '880'; // PAPER-WIDTH-001: 冻结显示
  $('font').value = String(s.docdeep_font);
  $('theme').value = s.docdeep_theme;
  document.documentElement.dataset.theme = (s.docdeep_theme === 'mo') ? 'dark' : 'light'; // 深色分支跟随页面墨色主题
  paintTemplates(s.docdeep_theme); // 模板卡选中态与下拉保持一致，改任一处两边同步
  if (typeof paintBackgroundConfig === 'function') paintBackgroundConfig(s[BACKGROUND_KEY]);
  $('tip').textContent = (s.docdeep_enabled !== false)

    ? '已启用。关闭后页面即恢复原站，无需刷新。'
    : '已关闭，原站样式已恢复，原功能不受影响。';
}
