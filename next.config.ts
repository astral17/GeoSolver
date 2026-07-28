import type { NextConfig } from "next";

const isPagesBuild =
  process.env.GITHUB_PAGES === "true" ||
  process.env.npm_lifecycle_event === "build:pages";
const [repositoryOwner = "", repositoryName = ""] = (
  process.env.GITHUB_REPOSITORY ?? ""
).split("/");
const isUserSite =
  repositoryName.toLowerCase() ===
  `${repositoryOwner.toLowerCase()}.github.io`;
const inferredBasePath =
  repositoryName && !isUserSite ? `/${repositoryName}` : "";
const basePath = process.env.PAGES_BASE_PATH ?? inferredBasePath;

const nextConfig: NextConfig = isPagesBuild
  ? {
      output: "export",
      trailingSlash: true,
      basePath,
      images: {
        unoptimized: true,
      },
    }
  : {};

export default nextConfig;
