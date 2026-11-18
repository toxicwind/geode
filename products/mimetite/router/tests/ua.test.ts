import { describe, expect, test } from "bun:test";
import {
  BROWSER_UA,
  CLAUDE_CODE_UA,
  UA_PROFILES,
  isAuthFailureBody,
  isBrowserUa,
  isUaBlocked,
  resolveUserAgent,
  uaForMode,
  uaRetryCandidate,
} from "../../catalog/src/ua.ts";

describe("UA registry", () => {
  test("every profile resolves to a non-empty identity", () => {
    for (const [name, profile] of Object.entries(UA_PROFILES)) {
      expect(profile.ua.length).toBeGreaterThan(0);
      expect(profile.ua).not.toContain("undefined");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("browser profile is the canonical Chrome identity", () => {
    expect(uaForMode("browser")).toBe(BROWSER_UA);
    expect(BROWSER_UA).toStartWith("Mozilla/5.0 (X11; Linux x86_64)");
    expect(BROWSER_UA).toContain("Chrome/141");
  });

  test("named agent profiles keep their wire shape", () => {
    expect(uaForMode("claude-code")).toBe(CLAUDE_CODE_UA);
    expect(CLAUDE_CODE_UA).toBe("claude-cli/2.1.280 (external, cli)");
    expect(uaForMode("codex")).toBe("codex_cli_rs/0.154.0 (Mac OS 26.6.2; arm64)");
    expect(uaForMode("kilo")).toBe("opencode-kilo-provider");
    expect(uaForMode("kappa")).toBe("opencode-kappa-provider");
  });

  test("passthrough resolves to nothing so the caller's UA survives", () => {
    expect(uaForMode("passthrough")).toBeUndefined();
  });
});

describe("resolveUserAgent precedence", () => {
  test("literal userAgent pin wins over a named policy", () => {
    expect(resolveUserAgent({ userAgent: "literal/1", ua: "browser" }, "client/2").ua).toBe("literal/1");
  });

  test("named policy wins over the caller's UA", () => {
    expect(resolveUserAgent({ ua: "browser" }, "claude-cli/9.9.9").ua).toBe(BROWSER_UA);
  });

  test("no config forwards the caller's UA", () => {
    expect(resolveUserAgent({}, "tau/1.0").ua).toBe("tau/1.0");
  });

  test("no config and no caller UA yields undefined", () => {
    expect(resolveUserAgent({}, undefined).ua).toBeUndefined();
    expect(resolveUserAgent({}, "   ").ua).toBeUndefined();
  });
});

describe("403 classification", () => {
  const CF_1010 =
    '{"type":"https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/","title":"Error 1010: Access denied","status":403,"detail":"The site owner has blocked access based on your browser\'s signature."}';

  test("Cloudflare fingerprint block is a UA problem, not an auth problem", () => {
    expect(isUaBlocked(CF_1010)).toBe(true);
    expect(isAuthFailureBody(CF_1010)).toBe(false);
  });

  test("a real credential rejection is an auth problem, not a UA problem", () => {
    const expired = '{"error":{"code":"api_key_expired","message":"no active credentials"}}';
    expect(isUaBlocked(expired)).toBe(false);
    expect(isAuthFailureBody(expired)).toBe(true);
  });

  test("groq's invalid-key body classifies as auth", () => {
    const groq = '{"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}';
    expect(isAuthFailureBody(groq)).toBe(true);
    expect(isUaBlocked(groq)).toBe(false);
  });
});

describe("uaRetryCandidate", () => {
  test("a non-browser UA gets one browser retry", () => {
    expect(uaRetryCandidate("curl/8.5.0")).toBe(BROWSER_UA);
    expect(uaRetryCandidate("python-httpx/0.27")).toBe(BROWSER_UA);
  });

  test("an already-browser UA gets no retry (would loop)", () => {
    expect(uaRetryCandidate(BROWSER_UA)).toBeUndefined();
    expect(uaRetryCandidate(undefined)).toBeUndefined();
  });
});

describe("isBrowserUa", () => {
  test("recognises real browser signatures", () => {
    expect(isBrowserUa(BROWSER_UA)).toBe(true);
    expect(isBrowserUa("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
  });

  test("rejects agent and CLI identities", () => {
    expect(isBrowserUa("claude-cli/2.1.280 (external, cli)")).toBe(false);
    expect(isBrowserUa("curl/8.5.0")).toBe(false);
    expect(isBrowserUa(undefined)).toBe(false);
  });
});