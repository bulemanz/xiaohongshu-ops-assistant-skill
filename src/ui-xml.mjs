function decodeXml(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseBounds(bounds) {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
    centerX: Math.round((Number(match[1]) + Number(match[3])) / 2),
    centerY: Math.round((Number(match[2]) + Number(match[4])) / 2)
  };
}

export function parseUiXml(xml) {
  const nodes = [];
  const pattern = /<node\b([^>]*?)(?:\/>|>)/g;
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    const attrs = {};
    const attrPattern = /([a-zA-Z:-]+)="([^"]*)"/g;
    let attrMatch;

    while ((attrMatch = attrPattern.exec(match[1])) !== null) {
      attrs[attrMatch[1]] = decodeXml(attrMatch[2]);
    }

    nodes.push({
      text: attrs.text || "",
      contentDesc: attrs["content-desc"] || "",
      resourceId: attrs["resource-id"] || "",
      className: attrs.class || "",
      clickable: attrs.clickable === "true",
      focusable: attrs.focusable === "true",
      focused: attrs.focused === "true",
      enabled: attrs.enabled !== "false",
      selected: attrs.selected === "true",
      longClickable: attrs["long-clickable"] === "true",
      hint: attrs.hint || "",
      bounds: parseBounds(attrs.bounds || "")
    });
  }

  return nodes;
}

export function findNode(nodes, matcher) {
  return nodes.find((node) => {
    if (!node.bounds) return false;
    if (matcher.text && node.text === matcher.text) return true;
    if (matcher.textIncludes && node.text.includes(matcher.textIncludes)) return true;
    if (matcher.textStartsWith && node.text.startsWith(matcher.textStartsWith)) return true;
    if (matcher.contentDesc && node.contentDesc === matcher.contentDesc) return true;
    if (
      matcher.contentDescIncludes &&
      node.contentDesc.includes(matcher.contentDescIncludes)
    ) {
      return true;
    }
    if (matcher.hint && node.hint === matcher.hint) return true;
    return false;
  });
}

export function uniqueVisibleTexts(nodes) {
  const seen = new Set();
  const texts = [];

  for (const node of nodes) {
    const value = node.text.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    texts.push(value);
  }

  return texts;
}
