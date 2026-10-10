import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command } from "../lib/types";
import { operations } from "../lib/operations";
import { projectMusicFacts, type AudioListTrack, type MusicMetadataState } from "../lib/musicMetadata";
import type { SearchHit } from "../lib/types";

/** Reads the existing audio.list projection without making playback depend on it. */
export function useMusicMetadata(workspaceID: string | undefined, loadedItems: readonly Pick<SearchHit, "subject_ref">[], command: Command) {
  const [boundState, setBoundState] = useState<{ workspaceID?: string; subjectKey: string; value: MusicMetadataState }>({ subjectKey: "", value: { status: "idle", records: new Map() } });
  const requestRef = useRef(0);
  const loadedSubjectKey = useMemo(() => [...new Set(loadedItems.map((item) => item.subject_ref?.trim()).filter(Boolean))].sort().join("\u0000"), [loadedItems]);

  const reload = useCallback(() => {
    if (!workspaceID?.trim()) {
      requestRef.current++;
      setBoundState({ subjectKey: loadedSubjectKey, value: { status: "idle", records: new Map() } });
      return;
    }
    const requestToken = ++requestRef.current;
    const subjectRefs = new Set(loadedSubjectKey ? loadedSubjectKey.split("\u0000") : []);
    const setState = (value: MusicMetadataState) => setBoundState({ workspaceID, subjectKey: loadedSubjectKey, value });
    setState({ status: "loading", records: new Map() });
    void command(operations.audio.list, { workspace_id: workspaceID }).then((response) => {
      if (requestRef.current !== requestToken) return;
      const data = response.data;
      if (response.status !== "SUCCEEDED" || data?.workspace_id !== workspaceID || !Array.isArray(data?.tracks)) {
        setState({ status: "unavailable", records: new Map() });
        return;
      }
      const currentlyLoaded = [...subjectRefs].map((subject_ref) => ({ subject_ref }));
      setState({ status: "ready", records: projectMusicFacts(workspaceID, currentlyLoaded, data.tracks as AudioListTrack[]) });
    }).catch(() => {
      if (requestRef.current === requestToken) setState({ status: "unavailable", records: new Map() });
    });
  }, [command, loadedSubjectKey, workspaceID]);

  useEffect(() => {
    reload();
    return () => { requestRef.current++; };
  }, [reload]);

  // Never show facts from an older workspace/listing while the next read starts.
  const stateMatches = workspaceID?.trim() && boundState.workspaceID === workspaceID && boundState.subjectKey === loadedSubjectKey;
  return { ...(stateMatches ? boundState.value : { status: "idle" as const, records: new Map() }), reload };
}
