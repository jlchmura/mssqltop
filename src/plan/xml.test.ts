import {describe, expect, it} from 'vitest';
import {child, decodeEntities, descendants, parseXml} from './xml.js';

describe('parseXml', () => {
	it('reads elements and attributes, dropping namespace prefixes and declarations', () => {
		const root = parseXml(`<?xml version="1.0"?>
			<!-- a comment -->
			<p:Root xmlns:p="urn:x" xmlns="urn:y" a="1" p:b='two'>
				<Child x="1"/>
				<Child x="2"><![CDATA[<Ignored/>]]><Leaf/></Child>
			</p:Root>`);
		expect(root.name).toBe('Root');
		expect(root.attrs).toEqual({a: '1', b: 'two'});
		expect(root.children.map(c => c.attrs.x)).toEqual(['1', '2']);
		expect(root.children[1]!.children.map(c => c.name)).toEqual(['Leaf']);
	});

	it('decodes entities in attribute values', () => {
		expect(parseXml('<A v="a &lt;= b &amp;&amp; c&#xa;d &#65; &quot;q&quot; &apos;s&apos;"/>').attrs.v).toBe(
			'a <= b && c\nd A "q" \'s\'',
		);
	});

	it('keeps attribute values containing > and the other quote', () => {
		expect(parseXml(`<A v="x > 'y'" w='"z"'/>`).attrs).toEqual({v: "x > 'y'", w: '"z"'});
	});

	it('rejects documents whose tags do not balance', () => {
		expect(() => parseXml('<A><B></A>')).toThrow(/unexpected <\/A>/);
		expect(() => parseXml('<A><B/>')).toThrow(/<A> is not closed/);
		expect(() => parseXml('</A>')).toThrow(/unexpected/);
		expect(() => parseXml('just text')).toThrow(/no root element/);
	});
});

describe('decodeEntities', () => {
	it('leaves unknown or invalid references alone', () => {
		expect(decodeEntities('&nbsp; &#0; &#x110000;')).toBe('&nbsp; &#0; &#x110000;');
	});
});

describe('child / descendants', () => {
	const root = parseXml('<R><A id="1"><B><A id="2"/></B></A><Stop><A id="3"/></Stop><A id="4"/></R>');

	it('finds the first direct child by name', () => {
		expect(child(root, 'A')?.attrs.id).toBe('1');
		expect(child(root, 'Missing')).toBeUndefined();
	});

	it('finds descendants depth-first, not looking inside stop elements', () => {
		expect(descendants(root, 'A').map(a => a.attrs.id)).toEqual(['1', '2', '3', '4']);
		expect(descendants(root, 'A', new Set(['Stop', 'A'])).map(a => a.attrs.id)).toEqual(['1', '4']);
	});
});
