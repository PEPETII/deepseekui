'use strict';

  // ---- 主页面大背景图：只在已确认的 DeepSeek 聊天工作区挂载 ----
  // 路由 + composer + 工作区壳层三重门控，登录/分享/404 等页面 fail-closed。
  const PAGE_BACKGROUND_ID = 'docdeep-page-background';
  const PAGE_BACKGROUND_ASSET = 'assets/backgrounds/main-background.png';
  const PAGE_BACKGROUND_IMAGE_CLASS = 'docdeep-page-background-image';
  const PAGE_BACKGROUND_MAX_DATA_URL_CHARS = Math.ceil(5 * 1024 * 1024 / 3) * 4 + 128;
  const PAGE_BACKGROUND_DATA_URL_RE = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/;

  function isChatWorkspacePath(pathname) {
    const rawPath = String(pathname ?? '').split(/[?#]/, 1)[0];
    const path = rawPath === '/' ? '/' : rawPath.replace(/\/+$/, '');
    if (!path) return false;
    // 新建会话可能停留在站点根路径；是否真是工作区仍由下方 DOM 门控确认。
    if (path === '/') return true;
    if (!/^\/(?:a\/)?chat(?:\/(?:s\/)?[0-9a-zA-Z_-]{3,})?$/.test(path)) return false;
    // 分享页不是可编辑聊天工作区；显式排除，避免仅凭路径形状误挂载。
    return !/^\/(?:a\/)?chat\/(?:share|shared)(?:\/|$)/i.test(path);
  }

  function isChatWorkspace() {
    if (!isChatWorkspacePath(location.pathname)) return false;
    const hasComposer = !!document.querySelector('textarea');
    const hasWorkspaceShell = !!document.querySelector(
      '[class~="the-header"], [style*="--sidebar-width"], .ds-virtual-list, '
      + '.ds-virtual-list-visible-items, .ds-message, [data-message-id]'
    );
    return hasComposer && hasWorkspaceShell;
  }

  function pageBackgroundConfig() {
    const source = typeof settings !== 'undefined' ? settings.docdeep_template_background : null;
    const dataUrl = typeof source?.dataUrl === 'string' ? source.dataUrl.trim() : '';
    return {
      enabled: source?.enabled !== false,
      dataUrl: PAGE_BACKGROUND_DATA_URL_RE.test(dataUrl) && dataUrl.length <= PAGE_BACKGROUND_MAX_DATA_URL_CHARS ? dataUrl : '',
    };
  }

  function pageBackgroundAssetUrl() {
    try { return chrome.runtime.getURL(PAGE_BACKGROUND_ASSET); } catch { return ''; }
  }

  function pageBackgroundUrl() {
    return pageBackgroundConfig().dataUrl || pageBackgroundAssetUrl();
  }

  function pageBackgroundNodes() {
    return [...document.querySelectorAll('#' + PAGE_BACKGROUND_ID + '.' + INJECTED)];
  }

  function removePageBackground() {
    pageBackgroundNodes().forEach(node => node.remove());
  }

  function pageBackgroundImageNode(background) {
    try { return background.querySelector('.' + PAGE_BACKGROUND_IMAGE_CLASS); } catch { return null; }
  }

  function applyPageBackgroundSource(background, url, custom) {
    const image = pageBackgroundImageNode(background);
    if (!custom) {
      if (image) image.remove();
      background.style.setProperty('--docdeep-page-background-image', `url("${url}")`);
      return;
    }
    background.style.removeProperty('--docdeep-page-background-image');
    const preview = image || document.createElement('img');
    preview.className = PAGE_BACKGROUND_IMAGE_CLASS;
    preview.alt = '';
    preview.setAttribute('aria-hidden', 'true');
    preview.hidden = false;
    preview.onerror = () => {
      preview.hidden = true;
      const fallback = pageBackgroundAssetUrl();
      if (fallback) background.style.setProperty('--docdeep-page-background-image', `url("${fallback}")`);
    };
    preview.onload = () => { preview.hidden = false; };
    preview.src = url;
    if (preview.parentElement !== background) background.append(preview);
  }

  function syncPageBackground() {
    const nodes = pageBackgroundNodes();
    const current = nodes.shift() || null;
    nodes.forEach(node => node.remove());
    if (!isOn() || !pageBackgroundConfig().enabled || !isChatWorkspace()) {
      if (current) current.remove();
      return;
    }
    const body = document.body;
    const config = pageBackgroundConfig();
    const url = pageBackgroundUrl();
    if (!body || !url) {
      if (current) current.remove();
      return;
    }
    const background = current || document.createElement('div');
    background.id = PAGE_BACKGROUND_ID;
    background.className = INJECTED;
    background.setAttribute('aria-hidden', 'true');
    background.setAttribute('data-doc-background', '1');
    applyPageBackgroundSource(background, url, !!config.dataUrl);
    if (background.parentElement !== body) body.prepend(background);
  }
