import assert from 'node:assert/strict';
import test from 'node:test';
import { salesOpportunityValue, normalizeSalesFunnelStage } from '../lib/sales-opportunity-value.ts';
import { harness, owner } from './support/project-workflow-harness.mjs';

test('funnel values follow budget, construction proposal, and the recorded award', () => {
  const data = { estimatedValue: '100000', proposalHandoff: { packetType: 'Construction Proposal', contractAmount: 123456.78 }, salesMetrics: { contractValue: 135000 } };
  for (const stage of ['New Lead', 'Qualified Opportunity', 'Estimating']) assert.equal(salesOpportunityValue({ ...data, stage }), 100000);
  for (const stage of ['Proposal Submitted', 'Negotiation', 'On Hold', 'Lost']) assert.equal(salesOpportunityValue({ ...data, stage }), 123456.78);
  assert.equal(salesOpportunityValue({ ...data, stage: 'Awarded' }), 135000);
  assert.equal(salesOpportunityValue({ ...data, stage: 'Awarded', proposalHandoff: { contractAmount: 999999 } }), 135000);
  assert.equal(salesOpportunityValue({ stage: 'Awarded', estimatedValue: '142000', proposalHandoff: { contractAmount: 123456 } }), 142000);
});

test('engagement fees, invalid numbers, missing data, and zero values cannot misstate a funnel amount', () => {
  assert.equal(salesOpportunityValue({ stage: 'Proposal Submitted', estimatedValue: '900000', proposalHandoff: { packetType: 'Preconstruction Letter of Engagement', contractAmount: 12000 } }), 900000);
  for (const invalid of [null, '', 'not money', Infinity, NaN, -100, {}, []]) {
    assert.equal(salesOpportunityValue({ stage: 'Negotiation', estimatedValue: '900000', proposalHandoff: { contractAmount: invalid } }), 900000);
  }
  assert.equal(salesOpportunityValue({ stage: 'Negotiation', estimatedValue: '900000', proposalHandoff: { contractAmount: 0 } }), 0);
  assert.equal(salesOpportunityValue(undefined), 0);
  assert.equal(salesOpportunityValue({ estimatedValue: '10.99' }), 10.99);
});

test('legacy discovery records belong to Qualified Opportunity without discarding their details', async () => {
  for (const stage of ['Site Visit And Discovery', 'Discovery / Site Visit', 'Qualified']) assert.equal(normalizeSalesFunnelStage(stage), 'Qualified Opportunity');
  const h = await harness();
  try {
    for (const [index, stage] of ['Site Visit And Discovery', 'Discovery / Site Visit'].entries()) {
      const id = `LEGACY-DISCOVERY-${index}`;
      await h.save('MEFFORD-SALES', 'Sales Opportunities', id, stage, { stage, estimatedValue: '543210.12', company: 'Preserved Customer', notes: 'Keep the site visit record', probability: '40' }, owner, 201);
      const row = h.row('MEFFORD-SALES', id);
      assert.equal(row.status, 'Qualified Opportunity');
      assert.equal(row.data.stage, 'Qualified Opportunity');
      assert.equal(row.data.company, 'Preserved Customer');
      assert.equal(row.data.notes, 'Keep the site visit record');
      assert.equal(row.data.estimatedValue, '543210.12');
      assert.equal(row.data.probability, '40');
    }
    assert.equal(h.outbound.length, 0);
  } finally { await h.close(); }
});
