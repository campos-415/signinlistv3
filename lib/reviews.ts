// Real customer reviews, pulled from the business's public Yelp listing
// (via its Yahoo Local aggregation). Keep these genuine — swap in newer
// ones as they come in rather than inventing quotes.
export const REVIEWS = [
  {
    name: "Rowena W.",
    date: "October 2025",
    rating: 5,
    quote:
      "One of the cleanest doggy daycares — spacious, light and airy, with dependable, attentive staff.",
  },
  {
    name: "Carmen E.",
    date: "August 2024",
    rating: 5,
    quote: "Never experienced a doggie daycare as pristine clean as this! The place is immaculate.",
  },
  {
    name: "Catrina L.",
    date: "June 2024",
    rating: 5,
    quote:
      "My dog loves going so much that all I have to do is say “daycare” in the morning and he runs to the front door.",
  },
  {
    name: "Sara B.",
    date: "June 2024",
    rating: 5,
    quote: "The facility is clean and bright.",
  },
];

export const REVIEW_SUMMARY = {
  average: 5.0,
  count: REVIEWS.length,
  source: "Yelp",
};
