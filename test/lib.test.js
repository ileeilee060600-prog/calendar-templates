// Unit tests for the pure logic in lib.js. Run: node test/lib.test.js
const CT = require('../lib.js');
const a = require('assert');
const H = 3600000;

// input parsing
a.deepStrictEqual(CT.parseTokens('deep work 14:30 45m'), { text: 'deep work', startMin: 870, duration: 45 });
a.deepStrictEqual(CT.parseTokens('gym 3pm 1h30'), { text: 'gym', startMin: 900, duration: 90 });
a.deepStrictEqual(CT.parseTokens('call @9 2h'), { text: 'call', startMin: 540, duration: 120 });
a.deepStrictEqual(CT.parseTokens('45m'), { text: '', startMin: null, duration: 45 });
a.deepStrictEqual(CT.parseTokens('read 1.5h'), { text: 'read', startMin: null, duration: 90 });

// fuzzy matching
a(CT.matchScore('Deep work', 'work') > 0);
a(CT.matchScore('Deep work', 'deep') > CT.matchScore('Deep work', 'work'));
a.strictEqual(CT.matchScore('Deep work', 'zzz'), 0);

// next free slot
a.strictEqual(CT.findSlot([[0, H]], 30, 0), H);
a.strictEqual(CT.findSlot([[2 * H, 3 * H]], 60, 0), 0);
a.strictEqual(CT.findSlot([[H / 2, H], [H, 2 * H]], 60, 0), 2 * H);
a.strictEqual(CT.findSlot([[H, 2 * H]], 90, 0), 2 * H);

// free windows and busy time
const busy = [[9 * H, 10 * H], [9.5 * H, 11 * H], [13 * H, 14 * H]];
a.deepStrictEqual(CT.freeGaps(busy, 8 * H, 22 * H, 15), [[8 * H, 9 * H], [11 * H, 13 * H], [14 * H, 22 * H]]);
a.strictEqual(CT.busyMinutes(busy, 8 * H, 22 * H), 180);
a.deepStrictEqual(CT.freeGaps([[8 * H, 8.9 * H]], 8 * H, 9 * H, 15), []);
a.deepStrictEqual(CT.freeGaps([], 10 * H, 9 * H, 15), []);

// colors
a.strictEqual(CT.colorHex('11'), '#d50000');
a.strictEqual(CT.colorHex(''), null);

console.log('lib.test.js: all passed');
