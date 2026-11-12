import { describe, expect, it } from "vitest";
import { testConfig } from "./helpers.js";

describe("config", () => {
  it("runs with no providers when their variables are unset", () => {
    expect(testConfig().providers).toEqual({});
  });

  it("treats your_* placeholders as unset", () => {
    const config = testConfig({
      GITHUB_CLIENT_ID: "your_github_client_id",
      GITHUB_CLIENT_SECRET: "your_github_client_secret",
      GITLAB_CLIENT_ID: "your_gitlab_client_id",
      GITLAB_CLIENT_SECRET: "your_gitlab_client_secret",
    });
    expect(config.providers).toEqual({});
  });

  it("enables a provider only when both id and secret are set", () => {
    const config = testConfig({ GITHUB_CLIENT_ID: "abc", GITHUB_CLIENT_SECRET: "def", GITLAB_CLIENT_ID: "x" });
    expect(Object.keys(config.providers)).toEqual(["github"]);
  });
});
