import Icon from "./Icon";

// Our support line on WhatsApp, with the country code and no plus.
const SUPPORT_NUMBER = "918591756934";

/**
 * The bar along the bottom of every page, holding Help via WhatsApp: a chat
 * with us, the hotel's name already written, so we know who is asking
 * without a first question.
 */
export default function SupportBar({ propertyName, email }) {
  const lines = [
    "Hello, I need help with the software.",
    "",
    propertyName ? `Property: ${propertyName}` : null,
    email ? `Login: ${email}` : null,
    "",
    "My question: ",
  ].filter((l) => l !== null);
  const href = `https://wa.me/${SUPPORT_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;

  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-40 flex h-[34px] items-center justify-between gap-2 px-3 md:px-4"
      style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}
    >
      <span className="min-w-0 truncate text-xs" style={{ color: "var(--text-muted)" }}>
        {propertyName || "Online Hotelier"}
      </span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-ghost flex-shrink-0 px-2 py-0.5 text-xs"
        title="Ask us on WhatsApp"
      >
        <Icon name="chat" size={14} />
        Help via WhatsApp
      </a>
    </footer>
  );
}
