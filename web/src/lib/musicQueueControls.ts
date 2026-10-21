import type { AudioTrack } from "./audioPlayback";

export type MusicCurrentPlayback = Pick<AudioTrack, "workspaceID" | "entryID" | "contentID" | "logicalSize" | "name"> & {
  status: "loading" | "starting" | "playing" | "paused" | "error";
};

/** First-party Music actions over the one App-owned transient queue. */
export type MusicQueueControls = {
  count: number;
  addTracks: (tracks: AudioTrack[]) => void;
  addNext?: (track: AudioTrack) => void;
  addNextTracks?: (tracks: AudioTrack[]) => void;
  show: () => void;
  currentPlayback?: MusicCurrentPlayback;
  toggleCurrentPlayback?: () => void;
};
