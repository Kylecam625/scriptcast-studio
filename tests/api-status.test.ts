import { describe, expect, it } from "vitest";
import { apiStatusReducer, initialApiStatus } from "@/lib/apiStatus";

describe("apiStatusReducer", () => {
  it("tracks pending and successful API activity with readable labels and elapsed time", () => {
    const pending = apiStatusReducer(initialApiStatus, {
      type: "start",
      task: "parse",
      now: 1000
    });

    expect(pending.current).toMatchObject({
      id: "parse-1000",
      task: "parse",
      label: "Parsing script",
      detail: "Asking OpenAI to identify speakers and turns.",
      state: "pending",
      startedAt: 1000
    });

    const finished = apiStatusReducer(pending, {
      type: "succeed",
      detail: "Found 3 characters and 9 lines.",
      now: 2400
    });

    expect(finished.current).toMatchObject({
      id: "parse-1000",
      label: "Parsing complete",
      state: "success",
      detail: "Found 3 characters and 9 lines.",
      elapsedMs: 1400,
      endedAt: 2400
    });
    expect(finished.recent[0]).toEqual(finished.current);
  });

  it("keeps a failed request visible with an actionable error message", () => {
    const pending = apiStatusReducer(initialApiStatus, {
      type: "start",
      task: "voices",
      now: 2000
    });

    const failed = apiStatusReducer(pending, {
      type: "fail",
      error: "ElevenLabs key is missing.",
      now: 2600
    });

    expect(failed.current).toMatchObject({
      task: "voices",
      label: "Loading voices",
      detail: "ElevenLabs key is missing.",
      state: "error",
      elapsedMs: 600
    });
    expect(failed.recent[0].state).toBe("error");
  });
});
