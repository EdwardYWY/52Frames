// A minimal XML reader for Node (tests and the snapshot script): just enough DOM (getElementsByTagName,
// getAttribute) for parseGscShowtimes, since Node has no DOMParser.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decode = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const hex = name[1].toLowerCase() === "x";
      return String.fromCodePoint(parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return ENTITIES[name] ?? whole;
  });

class Element {
  constructor(tagName, attributes) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = [];
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  getElementsByTagName(name) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.tagName === name) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

export function parseXml(text) {
  const doc = new Element("#document", {});
  const stack = [doc];
  const tagRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let match;
  while ((match = tagRe.exec(text))) {
    const [, closing, name, attrText, selfClosing] = match;
    if (!name) continue;
    const top = stack[stack.length - 1];
    if (closing) {
      if (top.tagName !== name) throw new Error(`mismatched </${name}>`);
      stack.pop();
      continue;
    }
    const attributes = {};
    for (const [, key, dq, sq] of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes[key] = decode(dq ?? sq);
    }
    const element = new Element(name, attributes);
    top.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length !== 1) throw new Error("unclosed element");
  return doc;
}
