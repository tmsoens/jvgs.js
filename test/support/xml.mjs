// A small, strict XML parser exposing the slice of the browser DOM the game
// uses: DOMParser#parseFromString, Document#documentElement/querySelector,
// Element#tagName/children/getAttribute/textContent. Node has no DOMParser,
// and this keeps the test suite free of dependencies.
//
// Like the browser's XML parser, malformed input does not throw: the result
// contains a <parsererror> element whose textContent describes the problem.

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
const NAME = /[A-Za-z_:][\w:.\-]*/y;

export class XmlElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.attributes = new Map();
        this.children = [];
        this.parentNode = null;
        this.text = "";
    }
    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    hasAttribute(name) { return this.attributes.has(name); }
    get textContent() {
        return this.text + this.children.map(c => c.textContent).join("");
    }
    /** Supports plain tag-name selectors only. */
    querySelector(tagName) {
        for (const child of this.children) {
            if (child.tagName === tagName) return child;
            const found = child.querySelector(tagName);
            if (found) return found;
        }
        return null;
    }
}

export class XmlDocument {
    constructor(documentElement) { this.documentElement = documentElement; }
    querySelector(tagName) {
        const root = this.documentElement;
        return root.tagName === tagName ? root : root.querySelector(tagName);
    }
}

function decode(text, at) {
    return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);?/g, (match, name) => {
        if (!match.endsWith(";")) throw new Error(`unterminated entity ${match} near ${at}`);
        if (name[0] === "#") {
            const code = name[1] === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return String.fromCodePoint(code);
        }
        if (!(name in ENTITIES)) throw new Error(`unknown entity &${name}; near ${at}`);
        return ENTITIES[name];
    });
}

export function parseXml(source) {
    let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
    const stack = [];
    let root = null;

    const fail = msg => { throw new Error(`${msg} at offset ${i}`); };
    const skipTo = (marker) => {
        const end = source.indexOf(marker, i);
        if (end < 0) fail(`expected ${marker}`);
        const content = source.slice(i, end);
        i = end + marker.length;
        return content;
    };
    const skipSpace = () => { while (i < source.length && /\s/.test(source[i])) i++; };
    const readName = () => {
        NAME.lastIndex = i;
        const m = NAME.exec(source);
        if (!m) fail("expected a name");
        i += m[0].length;
        return m[0];
    };
    const addText = (text) => {
        if (stack.length) stack[stack.length - 1].text += text;
        else if (text.trim()) fail("text outside the root element");
    };

    while (i < source.length) {
        if (source.startsWith("<?", i)) {
            i += 2; skipTo("?>");
        } else if (source.startsWith("<!--", i)) {
            i += 4; skipTo("-->");
        } else if (source.startsWith("<![CDATA[", i)) {
            i += 9; addText(skipTo("]]>"));
        } else if (source.startsWith("<!DOCTYPE", i)) {
            const bracket = source.indexOf("[", i), close = source.indexOf(">", i);
            if (bracket >= 0 && bracket < close) { i = bracket; skipTo("]"); }
            skipTo(">");
        } else if (source.startsWith("</", i)) {
            i += 2;
            const name = readName();
            skipSpace();
            if (source[i] !== ">") fail("expected >");
            i++;
            const open = stack.pop();
            if (!open || open.tagName !== name)
                fail(`mismatched closing tag </${name}> (open: ${open ? open.tagName : "none"})`);
        } else if (source[i] === "<") {
            i++;
            const element = new XmlElement(readName());
            for (;;) {
                const before = i;
                skipSpace();
                if (source.startsWith("/>", i) || source[i] === ">") break;
                if (i === before) fail("expected whitespace before attribute");
                const name = readName();
                skipSpace();
                if (source[i] !== "=") fail(`expected = after attribute ${name}`);
                i++;
                skipSpace();
                const quote = source[i];
                if (quote !== "\"" && quote !== "'") fail("expected quoted attribute value");
                i++;
                const raw = skipTo(quote);
                if (raw.includes("<")) fail("< in attribute value");
                if (element.attributes.has(name)) fail(`duplicate attribute ${name}`);
                element.attributes.set(name, decode(raw, i));
            }
            const selfClosing = source[i] === "/";
            i += selfClosing ? 2 : 1;
            if (stack.length) {
                element.parentNode = stack[stack.length - 1];
                element.parentNode.children.push(element);
            } else if (root) {
                fail("more than one root element");
            } else {
                root = element;
            }
            if (!selfClosing) stack.push(element);
        } else {
            const end = source.indexOf("<", i);
            const raw = source.slice(i, end < 0 ? source.length : end);
            addText(decode(raw, i));
            i += raw.length;
        }
    }
    if (stack.length) throw new Error(`unclosed element <${stack[stack.length - 1].tagName}>`);
    if (!root) throw new Error("no root element");
    return root;
}

export class DOMParser {
    parseFromString(text) {
        try {
            return new XmlDocument(parseXml(text));
        } catch (e) {
            const error = new XmlElement("parsererror");
            error.text = e.message;
            return new XmlDocument(error);
        }
    }
}
