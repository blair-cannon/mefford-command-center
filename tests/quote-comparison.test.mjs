import test from 'node:test';
import assert from 'node:assert/strict';
import {extractQuoteFields} from '../lib/quote-ocr.js';
import {emptyBidPackageData} from '../lib/procurement.ts';
import {reviewQuoteScope} from '../lib/quote-comparison.ts';

test('quote extraction preserves small prices, long multi-line scopes, exclusions and terms',()=>{const scope=Array.from({length:35},(_,i)=>`Provide specified panel assembly ${i+1}`).join('\n');const extracted=extractQuoteFields(`Reference: 20260911\nScope of Work:\n${scope}\nExclusions:\nUtility company connection fees\nAlternates:\nNone\nSchedule:\nSix weeks\nGrand Total: $850.25`);assert.equal(extracted.price,850.25);assert.ok(extracted.scope.includes('assembly 35'));assert.equal(extracted.exclusions,'Utility company connection fees');assert.equal(extracted.schedule,'Six weeks');assert.equal(extractQuoteFields('Project 20260911\nDated 09/11/2026').price,0);});

test('negated included-scope text cannot qualify as confirmed coverage',()=>{const data=emptyBidPackageData({scope:'Sales',trade:'Electrical',costCode:'2600.00',scopeDescription:'Lighting fixtures',scopeNature:'Labor And Material',budgetAmount:1000,deadline:'2099-01-01'});const bidder={vendorId:'cheap',vendorName:'Incomplete',acknowledgments:[],revisions:[{id:'q1',total:850,exclusions:'',ocr:{status:'Human Reviewed',reviewedPrice:850,reviewedScope:'Lighting fixtures are not included'}}],leveling:{scopeComplete:true,exclusionsReviewed:true,alternatesReviewed:true,clarificationsComplete:true,budgetCompared:true,leveledAmount:850}};assert.equal(reviewQuoteScope(data,bidder).eligible,false);assert.equal(reviewQuoteScope(data,bidder).coverage[0].status,'Excluded');});
