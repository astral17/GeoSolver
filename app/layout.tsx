import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegistration } from "./pwa-registration";

function getSiteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
    return new URL(
      configuredUrl.endsWith("/") ? configuredUrl : `${configuredUrl}/`,
    );
  }

  const [owner, repository] = (
    process.env.GITHUB_REPOSITORY ?? ""
  ).split("/");
  if (
    owner &&
    repository &&
    (process.env.GITHUB_ACTIONS === "true" ||
      process.env.GITHUB_PAGES === "true" ||
      process.env.npm_lifecycle_event === "build:pages")
  ) {
    const projectPath =
      repository.toLowerCase() === `${owner.toLowerCase()}.github.io`
        ? ""
        : `/${repository}`;
    return new URL(`https://${owner}.github.io${projectPath}/`);
  }

  return new URL("http://localhost:3000");
}

const siteUrl = getSiteUrl();
const title = "GeoSolver — геометрический решатель";
const description =
  "Интерактивный чертёж, произвольные геометрические ограничения и численный решатель — целиком в браузере.";
const themeScript = `
  (() => {
    try {
      const stored = localStorage.getItem("geosolver-theme");
      const theme =
        stored === "light" || stored === "dark"
          ? stored
          : matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      document.documentElement.dataset.theme = theme;
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  })();
`;

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title,
  description,
  applicationName: "GeoSolver",
  manifest: new URL("./manifest.webmanifest", siteUrl).toString(),
  icons: {
    icon: [
      { url: new URL("./icon.svg", siteUrl), type: "image/svg+xml" },
      {
        url: new URL("./icon-192.png", siteUrl),
        type: "image/png",
        sizes: "192x192",
      },
    ],
    apple: [
      {
        url: new URL("./apple-touch-icon.png", siteUrl),
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "GeoSolver",
    statusBarStyle: "default",
  },
  openGraph: {
    title,
    description,
    type: "website",
    images: [
      {
        url: new URL("./og.png", siteUrl),
        width: 1732,
        height: 910,
        alt: "Интерфейс GeoSolver",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [new URL("./og.png", siteUrl)],
  },
};

export const viewport: Viewport = {
  themeColor: "#5968f6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
