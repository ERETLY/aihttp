'use strict';

const crypto = require('crypto');

function closePage(page) {
  if (!page || typeof page.close !== 'function') return;
  try {
    const closed = page.close();
    if (closed && typeof closed.catch === 'function') closed.catch(function () {});
  } catch (e) {}
}

class PageRegistry {
  constructor(maxPages) {
    this.maxPages = maxPages;
    this.pages = new Map();
    this.legacy = null;
  }

  handleFor(page) {
    if (!page.__aihttpHandle) page.__aihttpHandle = 'page_' + crypto.randomBytes(12).toString('base64url');
    return page.__aihttpHandle;
  }

  get(id) {
    return this.pages.get(id) || null;
  }

  get legacyPage() {
    return this.legacy;
  }

  store(page, handle) {
    const id = handle || this.handleFor(page);
    page.__aihttpHandle = id;
    this.pages.delete(id);
    this.pages.set(id, page);
    this.trim(page);
    return id;
  }

  setLegacy(page) {
    this.legacy = page;
    return this.store(page, this.handleFor(page));
  }

  trim(keep) {
    while (this.pages.size > this.maxPages) {
      let evicted = false;
      for (const entry of this.pages) {
        if (entry[1] === keep || entry[1] === this.legacy) continue;
        this.pages.delete(entry[0]);
        closePage(entry[1]);
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  replace(handle, next) {
    const previous = this.pages.get(handle) || null;
    const wasLegacy = previous !== null && previous === this.legacy;
    next.__aihttpHandle = handle;
    this.pages.set(handle, next);
    if (wasLegacy || this.legacy === null) this.legacy = next;
    if (previous && previous !== next) closePage(previous);
    return handle;
  }

  values() {
    return this.pages.values();
  }

  closeAll() {
    for (const page of this.pages.values()) closePage(page);
    this.pages.clear();
    this.legacy = null;
  }
}

module.exports = { PageRegistry, closePage };
