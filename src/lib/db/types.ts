// Adatbázis sor-típusok (v0.2 §4, minimális oszlopok).
// Kézzel karbantartott — a foundation csomaghoz elég.

export type ArtifactStatus = "draft" | "in_review" | "approved";

export interface ClientRow {
  id: string;
  name: string;
  industry: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  client_id: string;
  name: string;
  package: string | null;
  status: string;
  created_at: string;
}

export interface PhaseInstanceRow {
  id: string;
  project_id: string;
  phase: string;
  state: string;
}

export interface InputItemRow {
  id: string;
  project_id: string;
  type: string;
  raw_text: string;
  created_at: string;
}

export interface ArtifactRow {
  id: string;
  project_id: string;
  type: string;
  version: number;
  status: ArtifactStatus;
  body: string;
  source_input_ids: string[];
  created_at: string;
}

export interface DecisionRow {
  id: string;
  project_id: string;
  kind: string;
  note: string | null;
  created_at: string;
}
