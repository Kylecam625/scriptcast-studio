export type ApiTask =
  | "chat"
  | "draft"
  | "parse"
  | "voices"
  | "enhance"
  | "generate"
  | "regenerate"
  | "export";

export type ApiActivityState = "pending" | "success" | "error";

export type ApiActivity = {
  id: string;
  task: ApiTask;
  label: string;
  detail: string;
  state: ApiActivityState;
  startedAt: number;
  endedAt: number | null;
  elapsedMs: number;
};

export type ApiStatusState = {
  current: ApiActivity | null;
  recent: ApiActivity[];
};

export type ApiStatusAction =
  | { type: "start"; task: ApiTask; detail?: string; now?: number }
  | { type: "succeed"; detail?: string; now?: number }
  | { type: "fail"; error: string; now?: number }
  | { type: "reset" };

export const initialApiStatus: ApiStatusState = {
  current: null,
  recent: []
};

const taskCopy: Record<ApiTask, { label: string; successLabel: string; detail: string }> = {
  chat: {
    label: "Idea chat",
    successLabel: "Idea reply received",
    detail: "Contacting OpenAI for story guidance."
  },
  draft: {
    label: "Writing script",
    successLabel: "Script drafted",
    detail: "Turning the idea chat into a parser-friendly script."
  },
  parse: {
    label: "Parsing script",
    successLabel: "Parsing complete",
    detail: "Asking OpenAI to identify speakers and turns."
  },
  voices: {
    label: "Loading voices",
    successLabel: "Voices loaded",
    detail: "Reading your ElevenLabs voice library."
  },
  enhance: {
    label: "Enhancing delivery",
    successLabel: "Delivery enhanced",
    detail: "Adding ElevenLabs v3 tags and sound effects."
  },
  generate: {
    label: "Generating audio",
    successLabel: "Audio generated",
    detail: "Sending dialogue chunks to ElevenLabs."
  },
  regenerate: {
    label: "Regenerating audio",
    successLabel: "Audio regenerated",
    detail: "Refreshing selected audio and captions."
  },
  export: {
    label: "Preparing export",
    successLabel: "Export ready",
    detail: "Saving generated files for download."
  }
};

export function apiStatusReducer(state: ApiStatusState, action: ApiStatusAction): ApiStatusState {
  if (action.type === "reset") {
    return initialApiStatus;
  }

  if (action.type === "start") {
    const now = action.now ?? Date.now();
    const copy = taskCopy[action.task];
    return {
      ...state,
      current: {
        id: `${action.task}-${now}`,
        task: action.task,
        label: copy.label,
        detail: action.detail || copy.detail,
        state: "pending",
        startedAt: now,
        endedAt: null,
        elapsedMs: 0
      }
    };
  }

  if (!state.current) {
    return state;
  }

  const now = action.now ?? Date.now();
  const copy = taskCopy[state.current.task];
  const next: ApiActivity = {
    ...state.current,
    label: action.type === "fail" ? state.current.label : copy.successLabel,
    detail: action.type === "fail" ? action.error : action.detail || "Done.",
    state: action.type === "fail" ? "error" : "success",
    endedAt: now,
    elapsedMs: Math.max(0, now - state.current.startedAt)
  };

  return {
    current: next,
    recent: [next, ...state.recent.filter((activity) => activity.id !== next.id)].slice(0, 4)
  };
}
