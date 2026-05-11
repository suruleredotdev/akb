/**
 * kb-viz manifest schema (TypeScript mirror).
 *
 * Generated to match `kb_viz/schema.py`. Keep these in sync; if Python changes,
 * update this file. Future improvement: derive this from the Pydantic models via
 * `datamodel-code-generator` or `pydantic.json_schema()` -> `json-schema-to-typescript`.
 */

// ---------------------------------------------------------------------------
// Core ID and primitive types
// ---------------------------------------------------------------------------

export type NodeId = string;
export type EdgeId = string;
export type FrameId = string;

// ---------------------------------------------------------------------------
// Type registries
// ---------------------------------------------------------------------------

export interface NodeTypeDisplay {
  label: string;
  color?: string | null;
  icon?: string | null;
}

export interface NodeType {
  id: string;
  parent_types: string[];
  child_types: string[];
  display: NodeTypeDisplay;
}

export interface AnnotationType {
  id: string;
  value_schema: Record<string, unknown>;
  projects_into: string[];
}

// ---------------------------------------------------------------------------
// Frame specifications
// ---------------------------------------------------------------------------

export type ScaleKind = "linear" | "log" | "time" | "categorical";

export interface AxisSpec {
  id: string;
  label: string;
  source: FrameSource;
  scale: ScaleKind;
  domain?: [number, number] | null;
}

export interface ReductionSpec {
  method: "umap" | "pacmap" | "pca" | "tsne" | "identity";
  dims: 2 | 3;
  scope: "global" | "per_parent";
  params: Record<string, unknown>;
}

export type FrameSource =
  | { from: "embedding"; reduce: ReductionSpec }
  | { from: "annotation"; type: string }
  | { from: "property"; property: string }
  | { from: "computed"; expr: string };

export interface FrameSpec {
  id: FrameId;
  label: string;
  kind: "embedding" | "temporal" | "geographic" | "linear" | "radial" | "categorical";
  source?: FrameSource | null;
  axes?: AxisSpec[] | null;
  description?: string | null;
}

// ---------------------------------------------------------------------------
// Properties bag (the projectable surface)
// ---------------------------------------------------------------------------

export type PropertyValue =
  | { kind: "scalar"; value: number; unit?: string | null }
  | { kind: "categorical"; value: string }
  | { kind: "vector"; value: number[]; dim: number }
  | { kind: "interval"; min: number; max: number; unit?: string | null };

// ---------------------------------------------------------------------------
// Annotation values (discriminated by `kind`)
// ---------------------------------------------------------------------------

export interface TemporalValue {
  kind: "temporal";
  iso_start: string;
  iso_end?: string | null;
  granularity: "year" | "month" | "day" | "hour" | "minute" | "second";
  raw?: string | null;
}

export interface GeographicValue {
  kind: "geographic";
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  region_id?: string | null;
  name?: string | null;
}

export interface NumericValue {
  kind: "numeric";
  value: number;
  unit?: string | null;
}

export interface EntityRefValue {
  kind: "entity_ref";
  entity_id: string;
  entity_type?: string | null;
  role?: string | null;
  name?: string | null;
}

export type AnnotationValue =
  | TemporalValue
  | GeographicValue
  | NumericValue
  | EntityRefValue;

export interface Annotation {
  id: string;
  type: string;                    // -> AnnotationType.id
  span?: [number, number] | null;  // char offsets in parent node text
  value: AnnotationValue;
  confidence?: number | null;
  source?: string | null;          // provenance (e.g. "akb:resolve_geo")
}

// ---------------------------------------------------------------------------
// Per-frame summaries (level-of-detail support)
// ---------------------------------------------------------------------------

export interface FrameSummary {
  count: number;
  centroid?: number[] | null;
  bbox?: number[] | null;
  hull?: number[][] | null;
  histogram?: number[] | null;
  histogram_bins?: number[] | null;
}

export interface NodeSummary {
  descendant_count: number;
  child_type_counts: Record<string, number>;
  frame_summaries: Record<FrameId, FrameSummary>;
}

// ---------------------------------------------------------------------------
// Nodes and edges
// ---------------------------------------------------------------------------

export interface Node {
  id: NodeId;
  type: string;                    // -> NodeType.id
  parent_id?: NodeId | null;
  child_ids: NodeId[];
  text?: string | null;

  embedding?: number[] | null;
  embedding_model?: string | null;

  properties: Record<string, PropertyValue>;
  annotations: Annotation[];
  summary?: NodeSummary | null;
}

export interface Edge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  type: string;                    // "next" | "similarity" | "citation" | "co_occurrence"
  weight?: number | null;
  properties: Record<string, PropertyValue>;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface ProcessingRun {
  id: string;
  step: string;
  model: string;
  config: Record<string, unknown>;
  timestamp: string;
}

export interface Provenance {
  runs: ProcessingRun[];
  source_db?: string | null;
  exported_at?: string | null;
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

export interface Manifest {
  version: "1";
  schema_id: string;
  label?: string | null;
  description?: string | null;

  node_types: NodeType[];
  annotation_types: AnnotationType[];
  frames: FrameSpec[];

  nodes: Node[];
  nodes_url?: string | null;
  edges: Edge[];
  edges_url?: string | null;

  provenance?: Provenance | null;
}

// ---------------------------------------------------------------------------
// Type narrowing helpers
// ---------------------------------------------------------------------------

export function isGeographic(v: AnnotationValue): v is GeographicValue {
  return v.kind === "geographic";
}
export function isTemporal(v: AnnotationValue): v is TemporalValue {
  return v.kind === "temporal";
}
export function isNumeric(v: AnnotationValue): v is NumericValue {
  return v.kind === "numeric";
}
export function isEntityRef(v: AnnotationValue): v is EntityRefValue {
  return v.kind === "entity_ref";
}

export function getScalar(
  node: Node,
  property: string,
): number | undefined {
  const p = node.properties[property];
  return p && p.kind === "scalar" ? p.value : undefined;
}

export function getCategorical(
  node: Node,
  property: string,
): string | undefined {
  const p = node.properties[property];
  return p && p.kind === "categorical" ? p.value : undefined;
}
