// Orchestrates Confluence tree export: discover → fetch bodies → convert → ZIP.
// Depends on ConfluenceApi, HtmlToMarkdown, ZipBuilder being loaded.
//
// Path layout inside ZIP:
//   <root-title>.md                              ← root page body (placeholder for folders)
//   <root-title>/<child>.md                      ← direct children
//   <root-title>/<child>/<grandchild>.md         ← deeper descendants
// Collisions resolved with "-{id-suffix}" suffix per parent.

(function (global) {
  'use strict';

  const MAX_PAGES = 100;
  const FETCH_CONCURRENCY = 3;

  // Discover the tree. Returns { nodes, truncated, rootTitle }.
  // Cap is MAX_PAGES + 1 so we can detect truncation reliably.
  async function preview(rootInfo, depthSetting) {
    const depth = normalizeDepth(depthSetting);
    return ConfluenceApi.discoverTree(rootInfo.origin, rootInfo, depth, MAX_PAGES + 1);
  }

  // Fetch all page bodies, convert to MD, build ZIP.
  // onProgress(done, total) called as each page completes.
  // Returns { blob, filename, skipped: [{ title, error }] }.
  async function exportTree(origin, rootTitle, nodes, onProgress) {
    // Trim to cap if discover overshot (it returns cap+1 to flag truncation).
    const workingNodes = nodes.slice(0, MAX_PAGES);
    const pageNodes = workingNodes.filter(n => n.type === 'page');
    let done = 0;

    const fetched = await ConfluenceApi.runQueue(pageNodes, async (node) => {
      const page = await ConfluenceApi.getPageWithBody(origin, node.id);
      done++;
      if (onProgress) onProgress(done, pageNodes.length);
      return page;
    }, FETCH_CONCURRENCY);

    const skipped = [];
    const pageById = new Map();
    fetched.forEach((res, i) => {
      const node = pageNodes[i];
      if (res.ok) pageById.set(node.id, res.value);
      else skipped.push({ title: node.title, error: res.error.message || String(res.error) });
    });

    const idToNode = new Map(workingNodes.map(n => [n.id, n]));
    const usedNames = new Map();  // parentKey -> Set of taken filenames

    function uniqueName(parentKey, baseName, id) {
      let taken = usedNames.get(parentKey);
      if (!taken) { taken = new Set(); usedNames.set(parentKey, taken); }
      let name = baseName;
      if (taken.has(name)) name = `${baseName}-${id.slice(-6)}`;
      taken.add(name);
      return name;
    }

    const entries = [];
    for (const node of workingNodes) {
      // Skip pages that failed to fetch — already in `skipped`.
      if (node.type === 'page' && !pageById.has(node.id)) continue;

      // Path segments = sanitized titles of ancestors (root → parent), in order.
      const segments = [];
      let cur = node;
      while (cur.parentId) {
        const parent = idToNode.get(cur.parentId);
        if (!parent) break;
        segments.unshift(HtmlToMarkdown.sanitizeTitle(parent.title));
        cur = parent;
      }
      const baseName = HtmlToMarkdown.sanitizeTitle(node.title);
      const parentKey = node.parentId || '__root__';
      const fileName = uniqueName(parentKey, baseName, node.id);
      const path = segments.concat(`${fileName}.md`).join('/');

      let md;
      if (node.type === 'folder') {
        md = `# ${node.title}\n\n_(Confluence folder — no page body)_\n`;
      } else {
        const page = pageById.get(node.id);
        md = HtmlToMarkdown.htmlStringToMarkdown(page.htmlBody, { pageTitle: page.title });
      }
      entries.push({ path, content: md });
    }

    if (skipped.length > 0) {
      const lines = skipped.map(s => `- ${s.title}: ${s.error}`).join('\n');
      entries.push({
        path: '_skipped.txt',
        content: `Pages skipped during export (permission denied, not found, or fetch failed):\n\n${lines}\n`
      });
    }

    const blob = await ZipBuilder.buildZip(entries);
    const filename = `${HtmlToMarkdown.sanitizeTitle(rootTitle)}.zip`;
    return { blob, filename, skipped };
  }

  function normalizeDepth(setting) {
    if (setting === 'all') return Infinity;
    const n = parseInt(setting, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  global.ConfluenceExport = { preview, exportTree, MAX_PAGES };
})(window);
