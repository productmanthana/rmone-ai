import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, maximum-scale=1, user-scalable=no"
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: mobileCSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const mobileCSS = `
  /* ── Make web simulation feel like a native mobile app ── */

  /* Hide all scrollbars */
  * {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
  }
  *::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }

  /* Remove text selection (native apps don't select text on tap) */
  * {
    -webkit-user-select: none !important;
    user-select: none !important;
    -webkit-tap-highlight-color: transparent !important;
    -webkit-touch-callout: none !important;
  }

  /* Allow selection in text inputs */
  input, textarea {
    -webkit-user-select: text !important;
    user-select: text !important;
  }

  /* Remove focus outlines — native apps have no browser focus ring */
  *:focus {
    outline: none !important;
  }
  *:focus-visible {
    outline: none !important;
  }

  /* Prevent pull-to-refresh and body scroll bounce */
  html, body {
    overflow: hidden !important;
    overscroll-behavior: none !important;
    height: 100% !important;
    position: fixed !important;
    width: 100% !important;
  }

  /* Use default cursor everywhere — no pointer cursor on hover */
  * {
    cursor: default !important;
  }
  input, textarea, [contenteditable] {
    cursor: text !important;
  }

  /* Smooth font rendering like native */
  * {
    -webkit-font-smoothing: antialiased !important;
    -moz-osx-font-smoothing: grayscale !important;
  }

  /* Remove button/pressable hover states that feel web-like */
  button:hover, [role="button"]:hover {
    opacity: 1 !important;
  }
`;
