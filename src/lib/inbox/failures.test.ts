import { describe, expect, it } from "vitest";
import { classifyFailure } from "@/lib/inbox/failures";
import { PermanentError, TransientError } from "@/lib/publisher/http";
import { reconnectMessage } from "@/lib/inbox/types";

const youtube403 = (reason: string, message: string) =>
  new PermanentError(
    `YouTube commentThreads failed (HTTP 403): ${JSON.stringify({ error: { code: 403, message, errors: [{ reason }] } })}`
  );
const meta = (status: number, code: number, message: string, label = "Instagram comments") =>
  new PermanentError(`${label} failed (HTTP ${status}): ${JSON.stringify({ error: { message, type: "OAuthException", code } })}`);

describe("classifyFailure", () => {
  it.each([
    ["YouTube insufficient scopes", youtube403("insufficientPermissions", "Request had insufficient authentication scopes.")],
    [
      "YouTube scope marker",
      new PermanentError('YouTube commentThreads failed (HTTP 403): {"error":{"details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}')
    ],
    [
      "Instagram code 10",
      meta(400, 10, "(#10) This endpoint requires the 'instagram_manage_comments' permission or the 'Instagram Public Content Access' feature")
    ],
    ["Facebook code 200", meta(403, 200, "(#200) Requires pages_read_engagement permission to manage the object", "Facebook comments")],
    ["Facebook missing user content scope", meta(403, 10, "(#10) This endpoint requires the 'pages_read_user_content' permission", "Facebook comments")],
    ["Threads permission", meta(403, 10, "(#10) Application does not have permission for this action", "Threads replies")],
    ["Threads named scope", new PermanentError("Threads replies failed (HTTP 400): the threads_read_replies permission is required")]
  ])("calls %s a missing scope", (_name, error) => {
    expect(classifyFailure(error)).toBe("scope");
  });

  it.each([
    ["Meta code 190", meta(400, 190, "Error validating access token: Session has expired")],
    ["an HTTP 401", new PermanentError("YouTube commentThreads failed (HTTP 401): unauthorized")],
    ["Google revoking the grant", new PermanentError('YouTube token refresh failed (HTTP 400): {"error":"invalid_grant"}')]
  ])("calls %s an auth failure", (_name, error) => {
    expect(classifyFailure(error)).toBe("auth");
  });

  it("does not mistake a scope error for an expired sign-in", () => {
    expect(classifyFailure(youtube403("insufficientPermissions", "Request had insufficient authentication scopes."))).not.toBe("auth");
  });

  it("recognises comments switched off on a video", () => {
    expect(classifyFailure(youtube403("commentsDisabled", "The video identified by the videoId parameter has disabled comments."))).toBe(
      "comments-disabled"
    );
  });

  it.each([
    ["a missing YouTube video", new PermanentError('YouTube commentThreads failed (HTTP 404): {"error":{"errors":[{"reason":"videoNotFound"}]}}')],
    [
      "a deleted Meta object",
      meta(400, 100, "Unsupported get request. Object with ID '123' does not exist, cannot be loaded due to missing permissions, or does not support this operation")
    ]
  ])("treats %s as gone", (_name, error) => {
    expect(classifyFailure(error)).toBe("gone");
  });

  it.each([
    ["YouTube quota", youtube403("quotaExceeded", "The request cannot be completed because you have exceeded your quota.")],
    ["Meta app limit", meta(400, 4, "(#4) Application request limit reached")],
    ["Meta call limit", meta(400, 17, "(#17) User request limit reached")],
    ["HTTP 429", new TransientError("Threads replies failed (HTTP 429): slow down")]
  ])("treats %s as throttled", (_name, error) => {
    expect(classifyFailure(error)).toBe("throttled");
  });

  it("leaves everything else as other", () => {
    expect(classifyFailure(new TransientError("Instagram comments network error: fetch failed"))).toBe("other");
    expect(classifyFailure(new TransientError("Instagram comments failed (HTTP 500): oops"))).toBe("other");
    expect(classifyFailure(undefined)).toBe("other");
  });
});

describe("reconnectMessage", () => {
  it("names the platform and the permission", () => {
    expect(reconnectMessage("youtube", "scope")).toBe("Reconnect YouTube with comment permission");
    expect(reconnectMessage("threads", "scope")).toBe("Reconnect Threads with comment permission");
    expect(reconnectMessage("facebook", "auth")).toBe("Reconnect Facebook");
  });
});
