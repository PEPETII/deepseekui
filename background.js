'use strict';

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function safeFilename(name, fallback = 'deepseek-conversation') {
  const cleaned = String(name || '')
    .replace(INVALID_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (cleaned || fallback).slice(0, 160);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'DOCDEEP_DOWNLOAD') return false;

  const mime = msg.format === 'json'
    ? 'application/json'
    : msg.format === 'html'
      ? 'text/html'
      : 'text/markdown';
  const extension = msg.format === 'json' ? 'json' : msg.format === 'html' ? 'html' : 'md';
  const filename = `${safeFilename(msg.filename)}.${extension}`;
  const content = typeof msg.content === 'string' ? msg.content : '';
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;

  chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
    const error = chrome.runtime.lastError;
    if (error) sendResponse({ ok: false, error: error.message });
    else sendResponse({ ok: Number.isInteger(downloadId), downloadId });
  });
  return true;
});
