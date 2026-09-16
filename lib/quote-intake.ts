export function emptyQuoteReview() {
  return { reviewedPrice: 0, reviewedScope: "", extractedPrice: 0, extractedScope: "", characterCount: 0, exclusions: "", alternates: "", allowances: "", qualifications: "", clarifications: "", schedule: "", confirmed: false, acknowledgedAddenda: [] as string[] };
}
