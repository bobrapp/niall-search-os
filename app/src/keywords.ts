const stop = new Set('about after also among and are before being can could does for from have into its may must our over per role should than that the their them these they this through use using was were what when where which who will with work would you your ability experience required preferred years'.split(' '));
const tokens = (text: string) => (text.normalize('NFKC').toLowerCase().match(/[\p{L}][\p{L}\p{N}+#]*(?:[.-][\p{L}\p{N}+#]+)*/gu) ?? [])
  .filter(term => term.length > 1 && !stop.has(term));
export function keywordMatch(description: string, resume: string) {
  const required = [...new Set(tokens(description))];
  const saved = new Set(tokens(resume));
  const hits = required.filter(term => saved.has(term));
  const missing = required.filter(term => !saved.has(term));
  return { score: required.length ? Math.round(hits.length / required.length * 100) : 0, hits, missing };
}
