export type Projection = 'globe' | 'mercator';
export type TrackEdge = 'top' | 'bottom' | 'left' | 'right';
export type TimestampPrecision = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';
export type ArtifactType = 'photo';

export interface Artifact {
  id: number;
  artifact_type: ArtifactType;
  latitude: number;
  longitude: number;
  timestamp: string;
  timestamp_precision: TimestampPrecision;
  title: string;
  description: string;
  tags: string[];
  collection_id: number | null;
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  created_at: string;
  artifact_count: number;
}

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface TimelineState {
  edge: TrackEdge;
  viewStart: Date;
  viewEnd: Date;
  windowStart: Date;
  windowEnd: Date;
}
