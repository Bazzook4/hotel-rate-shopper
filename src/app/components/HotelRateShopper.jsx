// No hooks here; can be a server or client component. Keep it simple as client-safe.
export default function HotelRateShopper({ data }) {
  if (!data) return null;

  const sponsored = (data.featured_prices || []).map((p, i) => ({
    id: `s-${i}`,
    source: p.source,
    logo: p.logo,
    link: p.link,
    price: p?.rate_per_night?.extracted_lowest ?? null,
    display: p?.rate_per_night?.lowest ?? "",
  }));

  const organic = (data.prices || []).map((p, i) => ({
    id: `o-${i}`,
    source: p.source,
    logo: p.logo,
    link: p.link,
    price: p?.rate_per_night?.extracted_lowest ?? null,
    display: p?.rate_per_night?.lowest ?? "",
  }));

  const organicSorted = organic
    .filter((x) => typeof x.price === "number")
    .sort((a, b) => a.price - b.price);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* Image */}
          <div className="w-full max-w-[180px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] backdrop-blur" >
            {Array.isArray(data.images) && data.images[0]?.thumbnail ? (
              <img
                src={data.images[0].thumbnail}
                alt={data.name}
                className="h-36 w-full object-cover"
              />
            ) : (
              <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-slate-800/80 to-slate-900/80 text-xs muted">No Image
              </div>
            )}
          </div>

          {/* Header */}
          <div className="flex-1 space-y-3">
            <div>
              <h3 className="h1">{data.name}</h3>
              <p className="sub">{data.address}</p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.15em] text-ink/80">
              {typeof data.overall_rating === "number" && (
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-slate-100">{data.overall_rating} ({data.reviews} reviews)
                </span>
              )}
              {data.location_rating && (
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1">Location {data.location_rating}
                </span>
              )}
              {data.deal && (
                <span className="rounded-full border border-amber-200/40 bg-[var(--warn-soft)] px-3 py-1 text-[var(--warn)]">{data.deal}
                </span>
              )}
              {data.rate_per_night?.lowest && (
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-slate-100">From {data.rate_per_night.lowest}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sponsored */}
        {sponsored.length > 0 && (
          <div className="mt-6">
            <h4 className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/70 mb-3">Sponsored
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sponsored.map((p) => (
                <a
                  key={p.id}
                  href={p.link}
                  target="_blank"rel="noreferrer"className="group rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-slate-100 transition hover:border-amber-200/60 hover:bg-amber-400/15"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--warn)] mb-2">Sponsored
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {p.logo ? (
                        <img src={p.logo} alt={p.source} className="w-6 h-6 rounded" />
                      ) : (
                        <div className="w-6 h-6 rounded bg-[var(--surface-2)]" />
                      )}
                      <div className="text-slate-100/90 font-medium">{p.source}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-semibold text-ink">
                        {p.display || (p.price ? `₹${p.price}` : "—")}
                      </div>
                      <div className="text-xs text-ink/70">per night</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Organic */}
        <div className="mt-6">
          <h4 className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/70 mb-3">Available rates
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {organicSorted.map((p) => (
              <a
                key={p.id}
                href={p.link}
                target="_blank"rel="noreferrer"className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-slate-100 transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {p.logo ? (
                      <img src={p.logo} alt={p.source} className="w-6 h-6 rounded" />
                    ) : (
                      <div className="w-6 h-6 rounded bg-[var(--surface-2)]" />
                    )}
                    <div className="text-slate-100/90 font-medium">{p.source}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold text-ink">
                      {p.display || (p.price ? `₹${p.price}` : "—")}
                    </div>
                    <div className="text-xs text-ink/70">per night</div>
                  </div>
                </div>
              </a>
            ))}
            {organicSorted.length === 0 && (
              <div className="card card-pad sub/70">No rates found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
