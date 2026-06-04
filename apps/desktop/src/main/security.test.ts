// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ASSET_PROTOCOL_SCHEME } from "./asset-library/asset-protocol-url.js";
import {
  buildContentSecurityPolicy,
  isExternalOpenAllowed,
  isNavigationAllowed,
  type SecurityContext,
} from "./security.js";

const DEV: SecurityContext = { isDev: true, devServerOrigin: "http://localhost:5173" };
const PROD: SecurityContext = { isDev: false, devServerOrigin: undefined };

const directives = (policy: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const part of policy.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") {
      continue;
    }
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) {
      map.set(trimmed, "");
      continue;
    }
    map.set(trimmed.slice(0, spaceIndex), trimmed.slice(spaceIndex + 1));
  }
  return map;
};

describe("buildContentSecurityPolicy (prod)", () => {
  const policy = buildContentSecurityPolicy(PROD);
  const dirs = directives(policy);

  it("blocks eval, inline scripts, and external script origins in prod", () => {
    // The renderer installs pixi.js/unsafe-eval so Pixi compiles shaders without
    // `new Function`; prod must therefore drop 'unsafe-eval' (regression guard).
    expect(dirs.get("script-src")).toBe("'self'");
    expect(dirs.get("script-src")).not.toContain("'unsafe-eval'");
    expect(dirs.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("keeps unsafe-inline only for styles (runtime style attributes)", () => {
    expect(dirs.get("style-src")).toBe("'self' 'unsafe-inline'");
  });

  it("allows the asset scheme for images and connect, plus loopback game host", () => {
    expect(dirs.get("img-src")).toContain(`${ASSET_PROTOCOL_SCHEME}:`);
    expect(dirs.get("connect-src")).toContain(`${ASSET_PROTOCOL_SCHEME}:`);
    expect(dirs.get("connect-src")).toContain("http://127.0.0.1:*");
    expect(dirs.get("connect-src")).toContain("ws://127.0.0.1:*");
    expect(dirs.get("connect-src")).toContain("ws://localhost:*");
  });

  it("allows data:/blob: in connect-src so Pixi can fetch bundled textures", () => {
    // Pixi's asset loader fetches bundled data:/blob: texture URLs; connect-src
    // (not img-src) governs fetch, so these must be present or playtest entity
    // textures fail with "Failed to fetch".
    expect(dirs.get("connect-src")).toContain("data:");
    expect(dirs.get("connect-src")).toContain("blob:");
  });

  it("does not reference any dev server origin", () => {
    expect(policy).not.toContain("5173");
  });

  it("locks down dangerous directives", () => {
    expect(dirs.get("object-src")).toBe("'none'");
    expect(dirs.get("frame-src")).toBe("'none'");
    expect(dirs.get("base-uri")).toBe("'self'");
    expect(dirs.get("default-src")).toBe("'self'");
  });
});

describe("buildContentSecurityPolicy (dev)", () => {
  const policy = buildContentSecurityPolicy(DEV);
  const dirs = directives(policy);

  it("relaxes scripts for Vite HMR (inline + eval + dev origin)", () => {
    const scriptSrc = dirs.get("script-src") ?? "";
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("http://localhost:5173");
  });

  it("allows the dev HMR websocket in connect-src", () => {
    expect(dirs.get("connect-src")).toContain("ws://localhost:5173");
    expect(dirs.get("connect-src")).toContain("http://localhost:5173");
  });
});

describe("isNavigationAllowed", () => {
  it("allows the dev server origin in dev", () => {
    expect(isNavigationAllowed("http://localhost:5173/projects", DEV)).toBe(true);
  });

  it("denies a different origin in dev", () => {
    expect(isNavigationAllowed("http://localhost:9999/", DEV)).toBe(false);
    expect(isNavigationAllowed("https://evil.example.com", DEV)).toBe(false);
  });

  it("allows the packaged file:// document in prod", () => {
    expect(isNavigationAllowed("file:///Applications/Tileborne.app/index.html", PROD)).toBe(true);
  });

  it("denies external http(s) in prod", () => {
    expect(isNavigationAllowed("https://evil.example.com", PROD)).toBe(false);
    expect(isNavigationAllowed("http://127.0.0.1:8787/rooms/x", PROD)).toBe(false);
  });

  it("denies malformed URLs", () => {
    expect(isNavigationAllowed("not a url", PROD)).toBe(false);
  });
});

describe("isExternalOpenAllowed", () => {
  it("allows https only", () => {
    expect(isExternalOpenAllowed("https://tileborne.dev/docs")).toBe(true);
    expect(isExternalOpenAllowed("http://insecure.example.com")).toBe(false);
    expect(isExternalOpenAllowed("file:///etc/passwd")).toBe(false);
    expect(isExternalOpenAllowed("javascript:alert(1)")).toBe(false);
    expect(isExternalOpenAllowed("garbage")).toBe(false);
  });
});
