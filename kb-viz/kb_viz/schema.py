"""kb-viz manifest schema.

The wire contract between akb (Python ingest) and kb-viz (TypeScript visualizer).

Design principles:
1. The hierarchy (document -> chunk -> expression) is independent of the projection
   frames (semantic, geographic, temporal, numeric, etc.). Any node may be projected
   into any frame for which it has the requisite property or annotation.
2. The `properties` bag on each node is the generic projectable surface. Things like
   `length`, `chunk_index`, `link_count`, or any future derived metric become
   projectable without schema changes.
3. Pre-computed `summary` blocks on parent nodes let the consumer render parents as
   regions/clusters at low zoom without walking the descendant tree at runtime.
4. Annotations follow the W3C Web Annotation Model loosely: typed values attached to
   a span within their parent node's text.
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Type registries
# ---------------------------------------------------------------------------


class NodeTypeDisplay(BaseModel):
    label: str
    color: str | None = None
    icon: str | None = None


class NodeType(BaseModel):
    """Declares a node type in the hierarchy taxonomy.

    For the akb default schema:
        document  -> top-level (one per akb `block`)
        chunk     -> child of document (one per akb `chunks` row)
        expression -> child of chunk (one per akb `ner_spans` row)
    """

    id: str
    parent_types: list[str] = Field(default_factory=list)
    child_types: list[str] = Field(default_factory=list)
    display: NodeTypeDisplay


class AnnotationType(BaseModel):
    """Declares a typed annotation kind.

    For the akb default schema, ner_spans of type LOC produce annotations of type
    `geographic`, TIME -> `temporal`, PERSON / ORG / KEYWORD -> `entity_ref`.
    """

    id: str
    value_schema: dict[str, Any] = Field(default_factory=dict)
    projects_into: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Frame specifications (declarative reference frames)
# ---------------------------------------------------------------------------


class AxisSpec(BaseModel):
    """One axis of a multi-axis frame (chart, radial)."""

    id: str
    label: str
    source: dict[str, Any]  # see FrameSource discriminated forms below
    scale: Literal["linear", "log", "time", "categorical"] = "linear"
    domain: tuple[float, float] | None = None


class ReductionSpec(BaseModel):
    """How to reduce raw embeddings into a low-d coordinate.

    `scope` is the load-bearing field for level-of-detail rendering:
      - "global" reduces the entire corpus once
      - "per_parent" reduces each parent's children independently, so when you
        drill into a document its sentences spread out usefully instead of all
        piling up where the document point used to sit.
    """

    method: Literal["umap", "pacmap", "pca", "tsne", "identity"]
    dims: Literal[2, 3] = 2
    scope: Literal["global", "per_parent"] = "global"
    params: dict[str, Any] = Field(default_factory=dict)


class FrameSpec(BaseModel):
    """A reference frame the consumer can render.

    `source` is a discriminated structure describing where coordinates come from:
        {"from": "embedding", "reduce": ReductionSpec}
        {"from": "annotation", "type": "<annotation_type_id>"}
        {"from": "property",   "property": "<property_name>"}
        {"from": "computed",   "expr": "<small expression>"}

    Multi-axis frames (charts, radial layouts) populate `axes` instead of `source`.
    """

    id: str
    label: str
    kind: Literal[
        "embedding", "temporal", "geographic", "linear", "radial", "categorical"
    ]
    source: dict[str, Any] | None = None
    axes: list[AxisSpec] | None = None
    description: str | None = None


# ---------------------------------------------------------------------------
# Properties and annotation values
# ---------------------------------------------------------------------------


class ScalarProperty(BaseModel):
    kind: Literal["scalar"] = "scalar"
    value: float
    unit: str | None = None


class CategoricalProperty(BaseModel):
    kind: Literal["categorical"] = "categorical"
    value: str


class VectorProperty(BaseModel):
    kind: Literal["vector"] = "vector"
    value: list[float]
    dim: int


class IntervalProperty(BaseModel):
    kind: Literal["interval"] = "interval"
    min: float
    max: float
    unit: str | None = None


PropertyValue = Union[
    ScalarProperty, CategoricalProperty, VectorProperty, IntervalProperty
]


class TemporalValue(BaseModel):
    kind: Literal["temporal"] = "temporal"
    iso_start: str  # ISO 8601, e.g. "1850-01-01" or "1850-01-01T00:00:00Z"
    iso_end: str | None = None  # for intervals; absent => point in time
    granularity: Literal["year", "month", "day", "hour", "minute", "second"] = "day"
    raw: str | None = None  # original surface form, e.g. "around 1850"


class GeographicValue(BaseModel):
    kind: Literal["geographic"] = "geographic"
    lat: float
    lng: float
    accuracy_m: float | None = None
    region_id: str | None = None  # e.g. ISO country, GeoNames id
    name: str | None = None  # surface form / resolved name


class NumericValue(BaseModel):
    kind: Literal["numeric"] = "numeric"
    value: float
    unit: str | None = None


class EntityRefValue(BaseModel):
    kind: Literal["entity_ref"] = "entity_ref"
    entity_id: str
    entity_type: str | None = None  # PERSON, ORG, KEYWORD, etc.
    role: str | None = None
    name: str | None = None  # surface form


AnnotationValue = Union[
    TemporalValue, GeographicValue, NumericValue, EntityRefValue
]


class Annotation(BaseModel):
    """A typed annotation attached to a span within the parent node's text.

    Span coordinates are character offsets within the *parent node's* text, matching
    Web Annotation Model TextPositionSelector semantics.
    """

    id: str
    type: str  # -> AnnotationType.id
    span: tuple[int, int] | None = None
    value: dict[str, Any]  # serialized AnnotationValue; consumer dispatches on `kind`
    confidence: float | None = None
    source: str | None = None  # provenance: "spacy:en_core_web_sm", "geopy", etc.

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Per-frame summary aggregations (level-of-detail support)
# ---------------------------------------------------------------------------


class FrameSummary(BaseModel):
    """Pre-computed aggregate of descendant positions in one frame.

    Lets the consumer render a parent as a region/cluster at low zoom without
    fetching or walking the descendants.
    """

    count: int
    centroid: list[float] | None = None
    bbox: list[float] | None = None  # [min_x, min_y, max_x, max_y, ...] in frame dims
    hull: list[list[float]] | None = None  # 2-d convex hull for polygon rendering
    histogram: list[float] | None = None  # 1-d distribution for temporal / numeric
    histogram_bins: list[float] | None = None  # bin edges aligned with histogram


class NodeSummary(BaseModel):
    descendant_count: int = 0
    child_type_counts: dict[str, int] = Field(default_factory=dict)
    frame_summaries: dict[str, FrameSummary] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Nodes and edges
# ---------------------------------------------------------------------------


class Node(BaseModel):
    """A unit in the containment hierarchy.

    Holds raw text (optional - large text can be lazy-loaded), the embedding (if
    computed at this level), a generic `properties` bag for projectable scalars,
    and span-attached typed annotations.
    """

    id: str
    type: str  # -> NodeType.id
    parent_id: str | None = None
    child_ids: list[str] = Field(default_factory=list)
    text: str | None = None

    embedding: list[float] | None = None
    embedding_model: str | None = None  # "fastembed:BAAI/bge-small-en-v1.5", etc.

    properties: dict[str, dict[str, Any]] = Field(default_factory=dict)
    annotations: list[Annotation] = Field(default_factory=list)
    summary: NodeSummary | None = None

    model_config = ConfigDict(extra="forbid")


class Edge(BaseModel):
    """Cross-references between nodes outside the parent/child tree.

    Used for the `next_chunk` linear ordering, similarity links between distant
    chunks, citations between documents, and co-occurrence between expressions.
    """

    id: str
    source: str
    target: str
    type: str  # "next" | "similarity" | "citation" | "co_occurrence"
    weight: float | None = None
    properties: dict[str, dict[str, Any]] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


class ProcessingRun(BaseModel):
    """Mirrors akb's `processing_runs` table - tracks which model/config produced
    which annotations or embeddings."""

    id: str
    step: str  # "chunk" | "embed" | "ner" | "resolve_geo" | "resolve_chrono"
    model: str
    config: dict[str, Any] = Field(default_factory=dict)
    timestamp: str  # ISO 8601


class Provenance(BaseModel):
    runs: list[ProcessingRun] = Field(default_factory=list)
    source_db: str | None = None  # e.g. "akb/data/archive.db"
    exported_at: str | None = None  # ISO 8601


# ---------------------------------------------------------------------------
# The manifest
# ---------------------------------------------------------------------------


class Manifest(BaseModel):
    """The complete wire format consumed by kb-viz.

    For corpora large enough that inline JSON is awkward (>10k nodes with
    embeddings), set `nodes_url` / `edges_url` to side-loaded Arrow or Parquet
    files instead of populating `nodes` / `edges` inline.
    """

    version: Literal["1"] = "1"
    schema_id: str  # identifies the hierarchy/annotation taxonomy in use
    label: str | None = None
    description: str | None = None

    node_types: list[NodeType]
    annotation_types: list[AnnotationType]
    frames: list[FrameSpec]

    nodes: list[Node] = Field(default_factory=list)
    nodes_url: str | None = None  # alternative to inline `nodes`
    edges: list[Edge] = Field(default_factory=list)
    edges_url: str | None = None

    provenance: Provenance | None = None

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Default schema for akb corpora
# ---------------------------------------------------------------------------


def default_akb_schema() -> dict[str, Any]:
    """The default node/annotation/frame registry for akb-derived manifests.

    Returns a dict with `node_types`, `annotation_types`, and `frames` lists
    suitable for splatting into a Manifest constructor.
    """
    return {
        "node_types": [
            NodeType(
                id="document",
                child_types=["chunk"],
                display=NodeTypeDisplay(label="Document", color="#4f46e5"),
            ),
            NodeType(
                id="chunk",
                parent_types=["document"],
                child_types=["expression"],
                display=NodeTypeDisplay(label="Chunk", color="#0ea5e9"),
            ),
            NodeType(
                id="expression",
                parent_types=["chunk"],
                display=NodeTypeDisplay(label="Expression", color="#f59e0b"),
            ),
        ],
        "annotation_types": [
            AnnotationType(
                id="geographic",
                projects_into=["map"],
            ),
            AnnotationType(
                id="temporal",
                projects_into=["timeline"],
            ),
            AnnotationType(
                id="entity_ref",
                projects_into=["entity_categorical"],
            ),
            AnnotationType(
                id="numeric",
                projects_into=["chart"],
            ),
        ],
        "frames": [
            FrameSpec(
                id="semantic_2d",
                label="Semantic space",
                kind="embedding",
                source={
                    "from": "embedding",
                    "reduce": ReductionSpec(
                        method="umap", dims=2, scope="global"
                    ).model_dump(),
                },
                description="2-D UMAP projection of chunk embeddings.",
            ),
            FrameSpec(
                id="map",
                label="Geographic map",
                kind="geographic",
                source={"from": "annotation", "type": "geographic"},
                description="Lat/lng of geographic annotations.",
            ),
            FrameSpec(
                id="timeline",
                label="Timeline",
                kind="temporal",
                source={"from": "annotation", "type": "temporal"},
                description="ISO date range of temporal annotations.",
            ),
            FrameSpec(
                id="length_position",
                label="Length vs position",
                kind="linear",
                axes=[
                    AxisSpec(
                        id="x",
                        label="Position in document",
                        source={"from": "property", "property": "position"},
                        scale="linear",
                        domain=(0.0, 1.0),
                    ),
                    AxisSpec(
                        id="y",
                        label="Chunk length (chars)",
                        source={"from": "property", "property": "length"},
                        scale="log",
                    ),
                ],
                description="Chunk position in document vs chunk length.",
            ),
        ],
    }
