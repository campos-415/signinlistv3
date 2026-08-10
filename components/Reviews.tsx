import { REVIEWS, REVIEW_SUMMARY } from "@/lib/reviews";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-accent-500" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </span>
  );
}

export default function Reviews() {
  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <Stars rating={5} />
        <p className="text-sm font-semibold text-slate-900">
          {REVIEW_SUMMARY.average.toFixed(1)} out of 5
        </p>
        <p className="text-sm text-slate-500">
          based on {REVIEW_SUMMARY.count} {REVIEW_SUMMARY.source} reviews
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {REVIEWS.map((review) => (
          <figure
            key={review.name + review.date}
            className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card"
          >
            <Stars rating={review.rating} />
            <blockquote className="mt-3 text-sm leading-relaxed text-slate-600">
              “{review.quote}”
            </blockquote>
            <figcaption className="mt-4 text-xs font-medium text-slate-400">
              {review.name} · {review.date} · {REVIEW_SUMMARY.source}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
