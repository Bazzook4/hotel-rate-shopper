import Icon from "./Icon";

// Our support line on WhatsApp, with the country code and no plus.
const SUPPORT_NUMBER = "918591756934";

/**
 * The bar along the bottom of every page: Show me how (the app's own
 * guides, TourGuide.jsx), then Help, and Feedback or a feature request,
 * each a WhatsApp chat with us with the hotel's name already written, so we
 * know who is asking without a first question.
 */
export default function SupportBar({ propertyName, email, onShowMe }) {
  const chat = (opening, ask) => {
    const lines = [
      opening,
      "",
      propertyName ? `Property: ${propertyName}` : null,
      email ? `Login: ${email}` : null,
      "",
      ask,
    ].filter((l) => l !== null);
    return `https://wa.me/${SUPPORT_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;
  };
  const links = [
    {
      label: "Feedback / Feature request",
      short: "Feedback",
      title: "Tell us what to improve or add, on WhatsApp",
      href: chat("Hello, I have feedback or a feature request for the software.", "My idea: "),
    },
    {
      label: "Help via WhatsApp",
      short: "Help",
      title: "Ask us on WhatsApp",
      href: chat("Hello, I need help with the software.", "My question: "),
    },
  ];

  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-40 flex h-[34px] items-center justify-between gap-2 px-3 md:px-4"
      style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}
    >
      <span className="min-w-0 truncate text-xs" style={{ color: "var(--text-muted)" }}>
        {propertyName || "Online Hotelier"}
      </span>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {onShowMe && (
          <button
            type="button"
            className="btn btn-ghost px-2 py-0.5 text-xs"
            data-track="Show me how"
            title="Walk through an everyday job on the real page"
            onClick={onShowMe}
          >
            <Icon name="compass" size={14} />
            <span className="sm:hidden">Show me</span>
            <span className="hidden sm:inline">Show me how</span>
          </button>
        )}
        {links.map((l) => (
          <a
            key={l.short}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost px-2 py-0.5 text-xs"
            data-track={`${l.short} on WhatsApp`}
            title={l.title}
          >
            <Icon name="chat" size={14} />
            {/* The short name on a phone, where the bar has little room. */}
            <span className="sm:hidden">{l.short}</span>
            <span className="hidden sm:inline">{l.label}</span>
          </a>
        ))}
      </div>
    </footer>
  );
}
