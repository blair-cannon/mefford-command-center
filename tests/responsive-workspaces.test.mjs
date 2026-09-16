import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import postcss from 'postcss';

const app = new URL('../app/', import.meta.url);
const sales = await readFile(new URL('sales-estimating.tsx', app), 'utf8');
const styles = await readFile(new URL('responsive-workspaces.css', app), 'utf8');
const css = postcss.parse(styles);
const parse = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const elements = (source) => { const result = []; function visit(n) { if (ts.isJsxElement(n)) result.push(n); ts.forEachChild(n, visit); } visit(source); return result; };
const attr = (node, name) => node.openingElement.attributes.properties.find(p => p.name?.getText() === name)?.initializer;
const value = (node, name) => { const v = attr(node, name); return v && ts.isStringLiteral(v) ? v.text : ''; };
const children = (node) => node.children.filter(c => !ts.isJsxText(c) || c.text.trim());

test('funnel has five active categories and exactly four data fields per card', () => {
  const sf = parse('sales.tsx', sales);
  let stages;
  function visit(n) { if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'funnelStages') stages = n.initializer.expression.elements.map(e => e.text); ts.forEachChild(n, visit); } visit(sf);
  assert.deepEqual(stages, ['New Lead', 'Qualified Opportunity', 'Estimating', 'Proposal Submitted', 'Negotiation']);
  const card = elements(sf).find(n => n.openingElement.attributes.getText(sf).includes('className={`funnel-card ${'));
  assert.ok(card);
  const fields = children(card);
  assert.equal(fields.length, 4);
  assert.deepEqual(fields.slice(1).map(n => value(n, 'className')), ['funnel-customer', 'funnel-value', 'funnel-salesperson']);
  const board = elements(sf).find(n => value(n, 'className') === 'funnel-board');
  assert.match(board.getText(sf), /funnelStages\.map/);
  assert.doesNotMatch(board.getText(sf), /outcomeStages|scrollBy|funnel-move-control|handoffMissing/);
  assert.match(sales, /Opportunity History/);
  assert.match(sales, /Open Production Project/);
});

test('reflow preserves all cap sheet, procurement, billing, and time-entry fields with their correct labels', async () => {
  const expected = {
    'estimate-editor.tsx': ['Cost Code And Scope', 'Qty', 'Unit', 'Material', 'Mefford Labor', 'Equipment', 'Subcontract', 'Other', 'Total'],
    'selections-workspace.tsx': ['SELECTION', 'COST CODE', 'MATERIAL DESCRIPTION', 'VENDOR', 'MANUFACTURER / PRODUCT', 'COLOR / SIZE', 'QTY / UNIT', 'UNIT COST', 'REQUIRED DELIVERY', 'PURCHASE SOURCE', 'ORDER STATUS'],
    'employee-home-tools.tsx': ['Date', 'Project / Overhead', 'Cost Code', 'Work Description', 'Type', 'Hours', 'Actions'],
  };
  for (const [file, labels] of Object.entries(expected)) {
    const sf = parse(file, await readFile(new URL(file, app), 'utf8'));
    const rows = elements(sf).filter(n => attr(n, 'data-reflow-row') && children(n).length === labels.length);
    assert.ok(rows.length, file);
    for (const row of rows) assert.deepEqual(children(row).map(n => value(n, 'data-label')), labels, file);
  }
  let rows = 0;
  for (const file of (await readdir(app)).filter(f => f.endsWith('.tsx'))) {
    const sf = parse(file, await readFile(new URL(file, app), 'utf8'));
    assert.equal(sf.parseDiagnostics.length, 0, file);
    for (const row of elements(sf).filter(n => attr(n, 'data-reflow-row'))) {
      rows++;
      for (const child of children(row)) if (ts.isJsxElement(child)) assert.ok(attr(child, 'data-label'), `${file}: unlabelled field`);
    }
  }
  assert.ok(rows >= 40);
});

test('responsive layouts wrap rather than hide horizontal overflow or scale away readable controls', async () => {
  css.walkDecls(d => {
    assert.ok(!(d.prop === 'overflow-x' && /hidden|clip|scroll|auto/.test(d.value)), `Horizontal escape: ${d.toString()}`);
    assert.ok(!(d.prop === 'transform' && /scale/.test(d.value)), 'Whole-page scaling is not responsive reflow');
  });
  const layout = await readFile(new URL('layout.tsx', app), 'utf8');
  assert.ok(layout.indexOf('./responsive-workspaces.css') > layout.indexOf('./work-surfaces.css'));
  for (const size of ['xl', 'wide', 'medium', 'small']) assert.match(styles, new RegExp(`data-reflow-row="${size}"`));
  assert.match(styles, /10 \* 3rem/);
  assert.match(styles, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@container sales \(max-width: 28rem\)/);
  assert.match(styles, /minmax\(min\(100%, 12rem\), 1fr\)/);
});
