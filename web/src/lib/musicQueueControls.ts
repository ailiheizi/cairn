import type { AudioTrack } from "./audioPlayback";

/** First-party Music actions over the one App-owned transient queue. */
export type MusicQueueControls = {
  count: number;
  addTracks: (tracks: AudioTrack[]) => void;
  show: () => void;
};
