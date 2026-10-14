import { describe, expect, it } from "vitest";
import { authFailureReason, isAuthFailure } from "@/lib/platform-health/auth";
import { ContainerRejectedError } from "@/lib/threads/api";
import { PermanentError, TransientError } from "@/lib/publisher/http";
import { YOUTUBE_RECONNECT_REQUIRED } from "@/lib/publisher/googleAuth";

const THREADS_401 =
  'Threads profile (nic_vandewetering) failed (HTTP 401): {"error":{"message":"Error validating access token: Session has expired on Thursday, 24-Sep-26 20:13:48 PDT. The current time is Friday, 25-Sep-26 03:53:09 PDT.","type":"OAuthException","code":190,"error_subcode":0,"fbtrace_id":"AJiQ1ksjPzKWrPsF42FHvXi"}}';

describe("isAuthFailure", () => {
  it.each([
    ["the Threads 401 from the live log", new PermanentError(THREADS_401)],
    [
      "Meta's code 190 on an HTTP 400",
      new PermanentError(
        'Instagram container create failed (HTTP 400): {"error":{"message":"Invalid OAuth access token - Cannot parse access token","type":"OAuthException","code":190}}'
      )
    ],
    ["a pretty-printed code 190", new PermanentError('Facebook publish failed (HTTP 400): {"error": {"code": 190}}')],
    ["a bare session expiry", new Error("Session has expired")],
    ["a plain string", "Threads publish failed (HTTP 401): unauthorized"],
    ["a rejection that wraps a container", new ContainerRejectedError("c-1", THREADS_401)],
    ["Google revoking the grant", new PermanentError(YOUTUBE_RECONNECT_REQUIRED)],
    [
      "Google's invalid_grant",
      new PermanentError('YouTube token refresh failed (HTTP 400): {"error":"invalid_grant","error_description":"Token has been expired or revoked."}')
    ],
    ["TikTok's refresh refusal", new PermanentError("TikTok token refresh failed: invalid_grant Refresh token is invalid")],
    ["TikTok's invalid access token", new PermanentError("TikTok publish init returned error access_token_invalid: The access token is invalid")]
  ])("recognises %s", (_name, error) => {
    expect(isAuthFailure(error)).toBe(true);
  });

  it.each([
    ["a permission error", new PermanentError("Threads publish failed (HTTP 403): permission denied")],
    ["a server error", new TransientError("Threads container create failed (HTTP 500): oops")],
    ["a rate limit", new TransientError("Threads container create failed (HTTP 429): slow down")],
    [
      "a Meta bad parameter",
      new PermanentError('Instagram container create failed (HTTP 400): {"error":{"message":"Invalid parameter","type":"OAuthException","code":100}}')
    ],
    ["a missing credential", new PermanentError("youtube credentials are not configured for this account.")],
    ["an id that merely contains 401", new Error("Threads posted 18636401494057998.")],
    ["a network failure", new TransientError("Threads publish network error: fetch failed")],
    ["the TikTok sandbox refusal", new PermanentError("TikTok will not take this post as scheduled: SANDBOX apps can only post privately")],
    ["nothing at all", undefined],
    ["an unrelated object", { status: 401 }]
  ])("ignores %s", (_name, error) => {
    expect(isAuthFailure(error)).toBe(false);
  });
});

describe("authFailureReason", () => {
  it("keeps the platform's own sentence and drops the JSON wrapper", () => {
    expect(authFailureReason(new PermanentError(THREADS_401))).toBe(
      "Error validating access token: Session has expired on Thursday, 24-Sep-26 20:13:48 PDT. The current time is Friday, 25-Sep-26 03:53:09 PDT."
    );
  });

  it("falls back to the message when there is no JSON body", () => {
    expect(authFailureReason(new PermanentError(YOUTUBE_RECONNECT_REQUIRED))).toBe(YOUTUBE_RECONNECT_REQUIRED);
  });

  it("is bounded so a page of provider JSON cannot reach the banner", () => {
    expect(authFailureReason(new Error(`HTTP 401 ${"x".repeat(5000)}`)).length).toBeLessThanOrEqual(300);
  });
});
