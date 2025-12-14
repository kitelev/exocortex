import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { UIStore, UISettings } from "./types";

const DEFAULT_UI_SETTINGS: UISettings = {
  showArchived: false,
  showEffortArea: false,
  showEffortVotes: false,
  showFullDateInEffortTimes: false,
  focusMode: false,
  showEmptySlots: true,
  showTime: true,
  showStatus: true,
};

export const useUIStore = create<UIStore>()(
  devtools(
    persist(
      (set) => ({
        ...DEFAULT_UI_SETTINGS,

        toggleArchived: () =>
          set(
            (state) => ({ showArchived: !state.showArchived }),
            false,
            "toggleArchived",
          ),

        toggleEffortArea: () =>
          set(
            (state) => ({ showEffortArea: !state.showEffortArea }),
            false,
            "toggleEffortArea",
          ),

        toggleEffortVotes: () =>
          set(
            (state) => ({ showEffortVotes: !state.showEffortVotes }),
            false,
            "toggleEffortVotes",
          ),

        toggleFullDate: () =>
          set(
            (state) => ({
              showFullDateInEffortTimes: !state.showFullDateInEffortTimes,
            }),
            false,
            "toggleFullDate",
          ),

        toggleFocusMode: () =>
          set(
            (state) => ({ focusMode: !state.focusMode }),
            false,
            "toggleFocusMode",
          ),

        toggleEmptySlots: () =>
          set(
            (state) => ({ showEmptySlots: !state.showEmptySlots }),
            false,
            "toggleEmptySlots",
          ),

        toggleTime: () =>
          set(
            (state) => ({ showTime: !state.showTime }),
            false,
            "toggleTime",
          ),

        toggleStatus: () =>
          set(
            (state) => ({ showStatus: !state.showStatus }),
            false,
            "toggleStatus",
          ),

        resetToDefaults: () =>
          set(DEFAULT_UI_SETTINGS, false, "resetToDefaults"),
      }),
      {
        name: "exocortex-ui-settings-v1",
        partialize: (state) => ({
          showArchived: state.showArchived,
          showEffortArea: state.showEffortArea,
          showEffortVotes: state.showEffortVotes,
          showFullDateInEffortTimes: state.showFullDateInEffortTimes,
          focusMode: state.focusMode,
          showEmptySlots: state.showEmptySlots,
          showTime: state.showTime,
          showStatus: state.showStatus,
        }),
      },
    ),
    {
      name: "UIStore",
    },
  ),
);

export const getUIDefaults = (): UISettings => ({ ...DEFAULT_UI_SETTINGS });
