import { describe, it, expect } from "vitest";
import { checkPasskeySupport, isInAppBrowser } from "./passkeySupport.js";

describe("checkPasskeySupport", () => {
  it("flags an insecure context (http://moss) as unsupported with an https hint", () => {
    // The exact field state Safari presents over plain http on a non-loopback
    // host: navigator.credentials / PublicKeyCredential are stripped.
    const r = checkPasskeySupport({
      isSecureContext: false,
      hasPublicKeyCredential: false,
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insecure-context");
    expect(r.message).toMatch(/secure connection|https/i);
  });

  it("flags a secure context that lacks WebAuthn as unsupported (not insecure)", () => {
    const r = checkPasskeySupport({
      isSecureContext: true,
      hasPublicKeyCredential: false,
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unsupported");
  });

  it("passes when secure and WebAuthn is present", () => {
    const r = checkPasskeySupport({
      isSecureContext: true,
      hasPublicKeyCredential: true,
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.message).toBeUndefined();
  });
});

describe("isInAppBrowser", () => {
  const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  // A WKWebView and a home-screen web app both send Safari's UA minus "Version/" and "Safari/".
  const NO_VERSION = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

  it("passes real Safari", () => {
    expect(isInAppBrowser(SAFARI, false)).toBe(false);
  });

  it("flags an iOS WebView", () => {
    expect(isInAppBrowser(NO_VERSION, false)).toBe(true);
  });

  it("passes Nido installed to the iOS home screen", () => {
    expect(isInAppBrowser(NO_VERSION, true)).toBe(false);
  });

  it("flags a named in-app browser whatever its UA otherwise says", () => {
    expect(isInAppBrowser(`${SAFARI} Instagram 300.0`, false)).toBe(true);
  });
});
