/**
 * A small XML reader for showplan documents. Showplan XML is machine-generated and well-formed, and
 * everything in it lives in attributes, so this only handles elements, attributes and the five
 * predefined entities (plus numeric character references); text content, comments, processing
 * instructions and CDATA are skipped.
 */

export interface XmlElement {
	/** Local name, without any namespace prefix. */
	name: string;
	attrs: Record<string, string>;
	children: XmlElement[];
}

const TAG =
	/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi;
const NAMED: Record<string, string> = {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'"};

/** Parses a document and returns its root element. Throws if there isn't one or tags don't balance. */
export function parseXml(text: string): XmlElement {
	const root: XmlElement = {name: '#document', attrs: {}, children: []};
	const stack: XmlElement[] = [root];
	for (const m of text.matchAll(TAG)) {
		const [, closing, qname, attrText, selfClosing] = m;
		if (!qname) continue; // comment, CDATA, <?xml?> or <!DOCTYPE>
		const name = localName(qname);
		if (closing) {
			const open = stack.pop();
			if (!open || open === root || open.name !== name) throw new Error(`Malformed XML: unexpected </${qname}>`);
			continue;
		}
		const el: XmlElement = {name, attrs: parseAttrs(attrText ?? ''), children: []};
		stack[stack.length - 1]!.children.push(el);
		if (!selfClosing) stack.push(el);
	}
	if (stack.length !== 1) throw new Error(`Malformed XML: <${stack[stack.length - 1]!.name}> is not closed`);
	const [first] = root.children;
	if (!first) throw new Error('Malformed XML: no root element');
	return first;
}

function parseAttrs(text: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const [, name, dq, sq] of text.matchAll(ATTR)) {
		if (name!.startsWith('xmlns')) continue;
		attrs[localName(name!)] = decodeEntities(dq ?? sq ?? '');
	}
	return attrs;
}

const localName = (qname: string) => qname.slice(qname.indexOf(':') + 1);

export function decodeEntities(s: string): string {
	if (!s.includes('&')) return s;
	return s.replace(ENTITY, (whole, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
		if (named) return NAMED[named.toLowerCase()] ?? whole;
		const code = hex ? parseInt(hex, 16) : Number(dec);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	});
}

/** The first direct child with this name. */
export const child = (el: XmlElement, name: string): XmlElement | undefined => el.children.find(c => c.name === name);

/** Every descendant with this name, depth-first, not looking inside elements named in `stopAt`. */
export function descendants(el: XmlElement, name: string, stopAt: ReadonlySet<string> = new Set()): XmlElement[] {
	const out: XmlElement[] = [];
	const visit = (e: XmlElement) => {
		for (const c of e.children) {
			if (c.name === name) out.push(c);
			if (!stopAt.has(c.name)) visit(c);
		}
	};
	visit(el);
	return out;
}
