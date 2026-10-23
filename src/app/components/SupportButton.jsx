import Icon from "./Icon";

// Our support line on WhatsApp, with the country code and no plus.
const SUPPORT_NUMBER = "918591756934";

/**
 * The top bar's Help button: a WhatsApp chat with us, the hotel's name
 * already written, so we know who is asking without a first question.
 */
export default function SupportButton({ propertyName, email }) {
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
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-ghost flex-shrink-0"
      aria-label="Help on WhatsApp"
      title="Ask us on WhatsApp"
    >
      <Icon name="chat" size={16} />
      {/* The icon alone on a phone, like the theme button beside it. */}
      <span className="hidden text-xs sm:inline">Help</span>
    </a>
  );
}
