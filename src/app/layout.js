import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BusyOverlay from "./components/BusyOverlay";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "HMS · Online Hotelier",
  description: "Hotel management by Online Hotelier: front office, distribution, parity and pricing",
};

// Stated rather than left to Next's default, so a phone lays the page out at
// its own width. Pinch zoom stays on: the grids are dense, and zooming in on
// a cell is how a desk reads one on a small screen.
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies the saved theme before first paint, so the page does not flash
 * light and then switch to dark.
 */
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        {/* Holds the app still while any change is being saved. */}
        <BusyOverlay />
      </body>
    </html>
  );
}
