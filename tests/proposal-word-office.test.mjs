import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {readProposalWord} from '../lib/proposal-word.ts';

test('an actual LibreOffice save preserves Word controls and every multiline list on reimport',async()=>{
  const current=JSON.parse(await readFile(new URL('./fixtures/proposal-word-office-base.json',import.meta.url),'utf8'));
  const bytes=await readFile(new URL('./fixtures/proposal-word-office-resaved.docx',import.meta.url));
  const result=await readProposalWord(bytes,current,'PRESSURE-099-PROPOSAL');
  assert.equal(result.changes.length,4);
  assert.equal(result.data.executiveSummary,'BROWSER PRESSURE TEST: accessible parking and phased municipal occupancy confirmed.');
  assert.equal(result.data.validThrough,'2026-11-15');
  assert.equal(result.data.paymentTerms,'Net 45');
  assert.equal(result.data.contractPrice,448223.27);
  assert.deepEqual(result.data.exclusions,current.exclusions);
  assert.deepEqual(result.data.recommendationSteps,current.recommendationSteps);
  assert.deepEqual(result.data.visuals,current.visuals);
  assert.deepEqual(result.data.issuedSnapshots,current.issuedSnapshots);
});
